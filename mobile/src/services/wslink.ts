/**
 * 原生 WebSocket 事件客户端 —— 直连桌面端（局域网模式）。
 *
 * 桌面端 /ws 使用原生 WebSocket + session token（与 React Native 的 WebSocket 兼容）。
 * 本模块解析桌面端 WsEnvelope 事件帧并更新 taskStore，
 * 替代 socket.io 直连（socket.io 仅用于云端中继）。
 */

import { useTaskStore } from "../store/taskStore";
import type { MessageAttachment } from "@ensemble/shared-protocol";

export interface WsLinkCallbacks {
  onChatMessage?: (msg: { runId: string; jobId?: string; agentId: string; content: string; attachment?: MessageAttachment }) => void;
  onChatDeleted?: (msg: { runId: string; msgId: string }) => void;
  onConnectionState?: (state: "connecting" | "connected" | "reconnecting" | "disconnected" | "error") => void;
  onRunStatus?: (runId: string, status: string) => void;
}

/** 桌面端 WsEnvelope 事件帧（与 server/src/api/ws/protocol.ts 对应） */
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
    attachment?: MessageAttachment;
    msgId?: string;
    event?: { type: string; tool?: string; input?: unknown; ts?: number };
  };
}

export class WsLink {
  private ws: WebSocket | null = null;
  private url: string | null = null;
  private reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manuallyClosed = false;
  private callbacks: WsLinkCallbacks = {};

  on(cb: WsLinkCallbacks): void {
    this.callbacks = { ...this.callbacks, ...cb };
  }

  /** 直连桌面端/云服务器：优先使用传入 token（用户会话），缺省回退 /api/ws-token bootstrap */
  async connect(ip: string, httpPort: number, token?: string | null): Promise<boolean> {
    let wsToken = token;
    if (!wsToken) {
      try {
        const res = await fetch(`http://${ip}:${httpPort}/api/ws-token`);
        if (!res.ok) return false;
        const data = (await res.json()) as { token?: unknown };
        if (typeof data.token !== "string") return false;
        wsToken = data.token;
      } catch {
        return false;
      }
    }
    this.token = wsToken;
    this.url = `ws://${ip}:${httpPort}/ws?token=${this.token}`;
    this.manuallyClosed = false;
    this.open();
    return true;
  }

  private token: string | null = null;

  /** 订阅一个 run 的事件（连接建立后发送） */
  subscribe(runId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "subscribe", runId }));
    }
  }

  /** 取消订阅 */
  unsubscribe(runId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "unsubscribe", runId }));
    }
  }

  /** 向 run 注入 steering 消息（直连对话） */
  steer(runId: string, content: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "steer", runId, content }));
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  disconnect(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.ws?.close();
    } catch {
      /* 忽略 */
    }
    this.ws = null;
    this.callbacks.onConnectionState?.("disconnected");
  }

  // ── 内部 ───────────────────────────────────────────────────────────────────

  private open(): void {
    if (!this.url) return;
    this.callbacks.onConnectionState?.("connecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.callbacks.onConnectionState?.("error");
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.callbacks.onConnectionState?.("connected");
      // 重连后重新订阅所有活跃 run
      const { runs } = useTaskStore.getState();
      for (const run of runs) {
        if (run.status === "running" || run.status === "queued") {
          this.subscribe(run.id);
        }
      }
    };

    ws.onmessage = (e) => {
      if (typeof e.data === "string") this.handleMessage(e.data);
    };

    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* 忽略 */
      }
    };

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (!this.manuallyClosed) {
        this.callbacks.onConnectionState?.("reconnecting");
        this.scheduleReconnect();
      } else {
        this.callbacks.onConnectionState?.("disconnected");
      }
    };
  }

  /** 解析桌面端 WsEnvelope 并更新 taskStore */
  private handleMessage(raw: string): void {
    let env: WsEnvelope;
    try {
      env = JSON.parse(raw);
    } catch {
      return;
    }
    if (env.v !== 1 || !env.runId || !env.event) return;

    const store = useTaskStore.getState();
    const ev = env.event;

    switch (ev.type) {
      case "run.status":
        if (ev.status) {
          store.updateRun(env.runId, { status: ev.status as never });
          this.callbacks.onRunStatus?.(env.runId, ev.status);
        }
        break;
      case "job.status":
        if (env.jobId && ev.status) {
          store.updateJob(env.jobId, { status: ev.status as never });
        }
        break;
      case "agent.event":
        if (env.jobId && ev.event) {
          const job = store.jobs.find((j) => j.id === env.jobId);
          store.updateJob(env.jobId, { events: [...(job?.events ?? []), ev.event as never] });
        }
        break;
      case "chat.message":
        this.callbacks.onChatMessage?.({
          runId: env.runId,
          jobId: env.jobId,
          agentId: ev.agentId ?? "agent",
          content: ev.content ?? "",
          attachment: ev.attachment,
        });
        break;
      case "chat.deleted":
        if (ev.msgId) {
          this.callbacks.onChatDeleted?.({ runId: env.runId, msgId: ev.msgId });
        }
        break;
      case "run.result":
        if (typeof ev.result === "string") {
          store.updateRun(env.runId, { finalResult: ev.result });
        }
        break;
      case "run.error":
        store.updateRun(env.runId, {
          status: "error" as never,
          error: ev.message ?? "执行出错",
        });
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    // 抖动防止雷群效应
    const delay = this.reconnectDelay + Math.random() * 1000;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 8000);
  }
}

// 导出单例
export const wsLink = new WsLink();
