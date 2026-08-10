import { useRunStore } from "../store/runs";

interface WsEnvelope {
  v: 1;
  ts: number;
  runId: string;
  seq: number;
  jobId?: string;
  event: {
    type: string;
    status?: string;
    jobId?: string;
    agentId?: string;
    content?: string;
    result?: string;
    message?: string;
    event?: {
      type: string;
      tool?: string;
      input?: unknown;
      ts?: number;
    };
  };
}

/**
 * WS 客户端：连接 /ws，自动重连（指数退避），按 runId 分发到 zustand store。
 * 断线重连后通过 REST /api/runs/:id/events?afterSeq= 补拉（见 catchUp）。
 */
class WsClient {
  private ws?: WebSocket;
  private subs = new Set<string>();
  private reconnectDelay = 1000;
  private reconnectTimer?: number;
  private localSeq = new Map<string, number>();
  private wsToken?: string;

  /** Fetch the session token from the server, then connect the WebSocket. */
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    // Fetch session token if we don't have one yet
    if (!this.wsToken) {
      try {
        const res = await fetch("/api/ws-token");
        if (res.ok) {
          const data = await res.json();
          this.wsToken = data.token;
        } else {
          console.warn("[ws] failed to fetch ws-token, status:", res.status);
        }
      } catch (err) {
        console.warn("[ws] failed to fetch ws-token:", err);
      }
    }

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const tokenParam = this.wsToken ? `?token=${this.wsToken}` : "";
    const ws = new WebSocket(`${proto}://${location.host}/ws${tokenParam}`);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 1000;
      for (const runId of this.subs) ws.send(JSON.stringify({ type: "subscribe", runId }));
    };

    ws.onmessage = (e) => {
      let env: WsEnvelope;
      try {
        env = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!env?.runId) return;
      this.apply(env);
    };

    ws.onclose = (e) => {
      // Clear token on abnormal close so it gets re-fetched (handles server restarts)
      if (e.code !== 1000) {
        this.wsToken = undefined;
      }
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  subscribe(runId: string): void {
    this.subs.add(runId);
    // wildcard（看板）：订阅所有运行，历史由 runs 列表/详情提供，不补拉
    if (runId === "*") {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "subscribe", runId }));
      }
      return;
    }
    // 本地已消费的 seq 与远端对齐 → 补拉缺失事件
    const lastSeq = this.localSeq.get(runId) ?? 0;
    void this.catchUp(runId, lastSeq);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "subscribe", runId }));
    }
  }

  unsubscribe(runId: string): void {
    this.subs.delete(runId);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "unsubscribe", runId }));
    }
  }

  cancel(runId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "cancel", runId }));
    }
  }

  steer(runId: string, content: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "steer", runId, content }));
    }
  }

  private apply(env: WsEnvelope): void {
    const store = useRunStore.getState();
    store.getOrCreate(env.runId);
    const ev = env.event;

    switch (ev.type) {
      case "run.status":
        store.setStatus(env.runId, ev.status ?? "");
        break;
      case "job.status":
        if (env.jobId)
          store.upsertJob(env.runId, env.jobId, { status: ev.status ?? "" });
        break;
      case "agent.event":
        if (env.jobId) {
          const payload = (ev as any).event ?? {};
          store.appendEvent(env.runId, { seq: env.seq, jobId: env.jobId, event: payload });
        }
        break;
      case "chat.message":
        store.appendMessage(env.runId, {
          jobId: env.jobId,
          agentId: ev.agentId ?? "agent",
          content: ev.content ?? "",
        });
        break;
      case "run.result":
        store.setFinal(env.runId, ev.result);
        break;
      case "run.error":
        store.setFinal(env.runId, undefined, ev.message);
        break;
    }

    this.localSeq.set(env.runId, Math.max(this.localSeq.get(env.runId) ?? 0, env.seq));
  }

  private async catchUp(runId: string, afterSeq: number): Promise<void> {
    try {
      const res = await fetch(`/api/runs/${runId}/events?afterSeq=${afterSeq}`);
      const json = (await res.json()) as any;
      const events: Array<{ seq: number; jobId?: string; event: unknown }> = json?.data?.events ?? [];
      const store = useRunStore.getState();
      for (const item of events) {
        store.appendEvent(runId, { seq: item.seq, jobId: item.jobId, event: item.event as any });
        this.localSeq.set(runId, Math.max(this.localSeq.get(runId) ?? 0, item.seq));
      }
    } catch {
      /* 忽略补拉错误 */
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    // 添加抖动防止雷群效应（thundering herd）
    const jitter = Math.random() * 1000;
    const delay = this.reconnectDelay + jitter;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 8000);
  }
}

export const wsClient = new WsClient();
