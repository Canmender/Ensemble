import { useRunStore, type AgentEventItem } from "../store/runs";
import { getSessionToken, resetSessionToken } from "./token";

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
    confirmId?: string;
    tool?: string;
    args?: unknown;
    msgId?: string;
    attachment?: {
      type: "image" | "file";
      name: string;
      size: number;
      mime?: string;
      url: string;
    };
    event?: {
      type: string;
      tool?: string;
      input?: unknown;
      ts?: number;
    };
  };
}

/** Minimal runtime type guard for WsEnvelope */
function isWsEnvelope(obj: unknown): obj is WsEnvelope {
  if (typeof obj !== "object" || obj === null) return false;
  const env = obj as Record<string, unknown>;
  return (
    env.v === 1 &&
    typeof env.runId === "string" &&
    typeof env.seq === "number" &&
    typeof env.event === "object" &&
    env.event !== null &&
    typeof (env.event as Record<string, unknown>).type === "string"
  );
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
  /** 重连成功回调（连接建立时触发；用于补拉 chat.message 等不走 run_events/seq 的数据） */
  private onOpenCbs: Array<() => void> = [];
  /** 消息撤回回调（chat.deleted） */
  private onChatDeletedCbs: Array<(msg: { runId: string; msgId: string }) => void> = [];

  /** 注册连接建立/重连成功回调 */
  onOpen(cb: () => void): void {
    this.onOpenCbs.push(cb);
  }

  /** 注册消息撤回回调 */
  onChatDeleted(cb: (msg: { runId: string; msgId: string }) => void): void {
    this.onChatDeletedCbs.push(cb);
  }

  /** Fetch the session token from the server, then connect the WebSocket. */
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    // Fetch session token if we don't have one yet
    if (!this.wsToken) {
      this.wsToken = (await getSessionToken()) ?? undefined;
      if (!this.wsToken) {
        console.warn("[ws] failed to fetch ws-token");
      }
    }

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const tokenParam = this.wsToken ? `?token=${this.wsToken}` : "";
    // 设备上报（电脑端/浏览器）：多端在线状态
    let deviceId = localStorage.getItem("ensemble_device_id");
    if (!deviceId) {
      deviceId = `web_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
      localStorage.setItem("ensemble_device_id", deviceId);
    }
    const devParams = tokenParam
      ? `&deviceId=${encodeURIComponent(deviceId)}&type=desktop&deviceName=${encodeURIComponent("电脑端")}`
      : "";
    const ws = new WebSocket(`${proto}://${location.host}/ws${tokenParam}${devParams}`);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 1000;
      for (const runId of this.subs) ws.send(JSON.stringify({ type: "subscribe", runId }));
      for (const cb of this.onOpenCbs) {
        try {
          cb();
        } catch {
          /* 重连回调异常不影响 WS 连接 */
        }
      }
    };

    ws.onmessage = (e) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!isWsEnvelope(parsed)) return;
      this.apply(parsed);
    };

    ws.onclose = (e) => {
      // Clear token on abnormal close so it gets re-fetched (handles server restarts)
      if (e.code !== 1000) {
        this.wsToken = undefined;
        resetSessionToken();
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

  sendToolConfirm(runId: string, confirmId: string, approved: boolean): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "tool_confirm", runId, confirmId, approved }));
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
        if (env.jobId && ev.event) {
          store.appendEvent(env.runId, { seq: env.seq, jobId: env.jobId, event: ev.event as AgentEventItem["event"] });
        }
        break;
      case "chat.message":
        store.appendMessage(env.runId, {
          jobId: env.jobId,
          agentId: ev.agentId ?? "agent",
          content: ev.content ?? "",
          attachment: ev.attachment,
        });
        break;
      case "chat.deleted":
        if (ev.msgId) {
          for (const cb of this.onChatDeletedCbs) {
            try {
              cb({ runId: env.runId, msgId: ev.msgId });
            } catch {
              /* 回调异常不影响 WS 连接 */
            }
          }
        }
        break;
      case "run.result":
        store.setFinal(env.runId, ev.result);
        break;
      case "run.error":
        store.setFinal(env.runId, undefined, ev.message);
        break;
      case "tool_confirm_request":
        if (ev.confirmId && ev.tool) {
          store.setPendingConfirm(env.runId, {
            confirmId: ev.confirmId,
            tool: ev.tool,
            args: ev.args,
          });
        }
        break;
    }

    this.localSeq.set(env.runId, Math.max(this.localSeq.get(env.runId) ?? 0, env.seq));
  }

  private async catchUp(runId: string, afterSeq: number): Promise<void> {
    try {
      const token = await getSessionToken();
      const res = await fetch(`/api/runs/${runId}/events?afterSeq=${afterSeq}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const json = (await res.json()) as { data?: { events?: Array<{ seq: number; jobId?: string; event: AgentEventItem["event"] }> } };
      const events = json?.data?.events ?? [];
      const store = useRunStore.getState();
      for (const item of events) {
        store.appendEvent(runId, { seq: item.seq, jobId: item.jobId, event: item.event });
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
