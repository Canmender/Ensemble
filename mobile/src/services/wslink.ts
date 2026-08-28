/**
 * 原生 WebSocket 事件客户端 —— 直连桌面端（局域网模式）。
 *
 * 桌面端 /ws 使用原生 WebSocket + session token（与 React Native 的 WebSocket 兼容）。
 * 本模块解析桌面端 WsEnvelope 事件帧并更新 taskStore，
 * 替代 socket.io 直连（socket.io 仅用于云端中继）。
 */

import { useTaskStore } from "../store/taskStore";
import type { MessageAttachment, MessageReply } from "@ensemble/shared";

/** WS 聊天消息（chat.message 事件负载） */
export interface ChatWsMessage {
  runId: string;
  jobId?: string;
  agentId: string;
  content: string;
  attachment?: MessageAttachment;
  replyTo?: MessageReply;
  mentions?: string[];
  /** 服务端消息 ID（v0.8.3+，与历史接口 id 一致，用于去重合并） */
  id?: string;
  /** 会话内单调 seq（v0.8.3+，补拉游标） */
  seq?: number;
}

export interface MentionEvent {
  convId: string;
  convTitle: string;
  senderId: string;
  senderName: string;
  content: string;
}

/** WebRTC 通话信令载荷 */
export interface CallSignal {
  kind: "offer" | "answer" | "candidate" | "hangup" | "accept" | "reject" | "calling";
  sdp?: string;
  candidate?: unknown;
  /** 视频通话标记（随 offer 携带；缺省为语音通话） */
  video?: boolean;
  from?: { userId: string; name?: string };
  target?: { userId: string };
}

/** 来自服务端定向转发的通话信令（call.signal 事件） */
export interface IncomingCallSignal {
  fromUserId: string;
  fromName?: string;
  call: CallSignal;
}

export interface WsLinkCallbacks {
  onChatMessage?: (msg: ChatWsMessage) => void;
  onChatDeleted?: (msg: { runId: string; msgId: string }) => void;
  onChatRead?: (msg: { runId: string; userId: string; readTs: string }) => void;
  onChatMention?: (msg: MentionEvent) => void;
  onDeviceStatus?: (msg: { deviceId: string; name: string; kind: string; online: boolean }) => void;
  onConnectionState?: (state: "connecting" | "connected" | "reconnecting" | "disconnected" | "error") => void;
  onRunStatus?: (runId: string, status: string) => void;
  onKicked?: (message: string) => void;
  onCall?: (msg: IncomingCallSignal) => void;
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
    replyTo?: MessageReply;
    mentions?: string[];
    msgId?: string;
    userId?: string;
    readTs?: string;
    fromUserId?: string;
    fromName?: string;
    call?: CallSignal;
    convId?: string;
    convTitle?: string;
    senderId?: string;
    senderName?: string;
    deviceId?: string;
    name?: string;
    kind?: string;
    online?: boolean;
    /** chat.message：服务端消息 ID / 会话内单调 seq（v0.8.3+） */
    id?: string;
    seq?: number;
    event?: { type: string; tool?: string; input?: unknown; ts?: number };
  };
}

export class WsLink {
  private ws: WebSocket | null = null;
  private url: string | null = null;
  private reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private manuallyClosed = false;
  private callbacks: WsLinkCallbacks = {};
  /** 全局聊天消息监听（弹通知 / 未读红点用，不随页面 on() 覆盖） */
  private globalChatMessageCbs: Array<(msg: ChatWsMessage) => void> = [];
  private globalMentionCbs: Array<(msg: MentionEvent) => void> = [];
  /** 断线重连成功后的补拉回调（页面/服务各自注册增量同步动作） */
  private resyncCbs: Array<() => void> = [];
  /** 首次连接不触发补拉（挂载时本就全量加载）；仅重连触发 */
  private hasConnectedOnce = false;
  /** 每个 run 已见的最大 WsEnvelope.seq（补拉游标；同一服务器会话内跨重连保留） */
  private seqByRun = new Map<string, number>();

  on(cb: WsLinkCallbacks): () => void {
    this.callbacks = { ...this.callbacks, ...cb };
    // 返回清理函数：组件 unmount 时调用
    return () => {
      const keys = Object.keys(cb) as Array<keyof WsLinkCallbacks>;
      for (const key of keys) {
        if (this.callbacks[key] === (cb as any)[key]) {
          (this.callbacks as any)[key] = undefined;
        }
      }
    };
  }

  /** 注册全局聊天消息监听（始终触发，页面 onChatMessage 覆盖不影响） */
  onGlobalChatMessage(cb: (msg: ChatWsMessage) => void): void {
    this.globalChatMessageCbs.push(cb);
  }

  /**
   * 注册「重连补拉」回调：每次断线重连成功（含订阅恢复）后触发一次。
   * 用于把断线窗口内错过的事件/消息按 HTTP 增量拉回。返回取消注册函数。
   */
  onResync(cb: () => void): () => void {
    this.resyncCbs.push(cb);
    return () => {
      this.resyncCbs = this.resyncCbs.filter((f) => f !== cb);
    };
  }

  /** 某 run 本地已见的最大 seq（无记录返回 0） */
  getLastSeq(runId: string): number {
    return this.seqByRun.get(runId) ?? 0;
  }

  /** 抬高某 run 的补拉游标（如从 REST 响应的 lastSeq 初始化） */
  setLastSeq(runId: string, seq: number): void {
    if (!Number.isFinite(seq)) return;
    this.seqByRun.set(runId, Math.max(this.seqByRun.get(runId) ?? 0, seq));
  }

  private fireResync(): void {
    for (const cb of this.resyncCbs) {
      try {
        cb();
      } catch {
        /* 单个补拉异常不影响其他 */
      }
    }
  }

  /** 全局 @提及监听（被@时始终弹通知，不受 lastActiveConvId 限制） */
  onGlobalMention(cb: (msg: MentionEvent) => void): void {
    this.globalMentionCbs.push(cb);
  }

  /** 直连桌面端/云服务器：优先使用传入 token（用户会话），缺省回退 /api/ws-token bootstrap；device 用于多端在线注册 */
  async connect(
    ip: string,
    httpPort: number,
    token?: string | null,
    device?: { id: string; name: string; type: string },
  ): Promise<boolean> {
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
    const params = new URLSearchParams({ token: this.token });
    if (device) {
      params.set("deviceId", device.id);
      params.set("deviceName", device.name);
      params.set("type", device.type);
    }
    this.url = `ws://${ip}:${httpPort}/ws?${params.toString()}`;
    this.manuallyClosed = false;
    // 新会话：游标与首连标记重置（seq 只在同一服务器会话内有意义）
    this.seqByRun.clear();
    this.hasConnectedOnce = false;
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

  /** 发送 WebRTC 通话信令给指定用户（经服务端定向转发） */
  sendCall(targetUserId: string, call: CallSignal): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "call", targetUserId, call }));
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
    this.stopHeartbeat();
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
      // 启动心跳：每 3s 发送，检测连接存活
      this.startHeartbeat();
      // 重连成功（非首次）→ 通知各处做增量补拉
      if (this.hasConnectedOnce) {
        this.fireResync();
      }
      this.hasConnectedOnce = true;
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
    // runId 可为空：用户定向事件（call.signal / chat.mention / device.status / auth.kicked 等）无 runId
    if (env.v !== 1 || !env.event) return;
    // 记录 per-run 补拉游标（服务端事件先落库分配 seq 再广播）
    if (env.runId && typeof env.seq === "number") {
      this.setLastSeq(env.runId, env.seq);
    }

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
        {
          const chatMsg: ChatWsMessage = {
            runId: env.runId,
            jobId: env.jobId,
            agentId: ev.agentId ?? "agent",
            content: ev.content ?? "",
            attachment: ev.attachment,
            replyTo: ev.replyTo,
            mentions: ev.mentions,
            id: ev.id,
            seq: ev.seq,
          };
          this.callbacks.onChatMessage?.(chatMsg);
          for (const cb of this.globalChatMessageCbs) {
            try {
              cb(chatMsg);
            } catch {
              /* 全局监听异常不影响 WS 连接 */
            }
          }
        }
        break;
      case "chat.mention":
        {
          const mentionData: MentionEvent = {
            convId: ev.convId ?? "",
            convTitle: ev.convTitle ?? "",
            senderId: ev.senderId ?? "",
            senderName: ev.senderName ?? "",
            content: ev.content ?? "",
          };
          this.callbacks.onChatMention?.(mentionData);
          for (const cb of this.globalMentionCbs) {
            try {
              cb(mentionData);
            } catch {
              /* 全局监听异常不影响 WS 连接 */
            }
          }
        }
        break;
      case "chat.deleted":
        if (ev.msgId) {
          this.callbacks.onChatDeleted?.({ runId: env.runId, msgId: ev.msgId });
        }
        break;
      case "chat.read":
        if (ev.userId && ev.readTs) {
          this.callbacks.onChatRead?.({ runId: env.runId, userId: ev.userId, readTs: ev.readTs });
        }
        break;
      case "device.status":
        if (ev.deviceId) {
          this.callbacks.onDeviceStatus?.({
            deviceId: ev.deviceId,
            name: ev.name ?? "",
            kind: ev.kind ?? "mobile",
            online: !!ev.online,
          });
        }
        break;
      case "auth.kicked":
        this.callbacks.onKicked?.(ev.message ?? "您的账号在其他设备登录");
        break;
      case "call.signal":
        if (ev.call) {
          this.callbacks.onCall?.({ fromUserId: ev.fromUserId ?? "", fromName: ev.fromName, call: ev.call });
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

  /** 心跳：每 3s 发送 ping，服务端回 pong，超时未收到则判定断线 */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try { this.ws.send(JSON.stringify({ type: "ping" })); } catch {}
      }
    }, 3000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

// 导出单例
export const wsLink = new WsLink();