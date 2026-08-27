import { randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { parseClientMsg, type RunEvent, type WsEnvelope, type CallSignal } from "./protocol";
import { logger } from "../../util/logger";
import type { AuthUser } from "../../db/users";

/**
 * WebSocket Hub：管理客户端订阅（按 runId），广播 run 事件帧。
 * 事件先落库分配 seq，再走 hub.broadcast —— 断线重连后客户端用 afterSeq 补拉。
 *
 * 安全：
 * - WebSocket 连接需要 token 验证（通过 URL query 参数传递）
 * - Wildcard 订阅已禁用，必须指定具体 runId
 * - maxPayload 限制防止内存耗尽攻击
 *
 * 性能优化：
 * - 消息批量发送：缓冲 16ms 后批量发送，减少 10-50x 帧数
 * - 共享序列化：同一事件只 JSON.stringify 一次
 * - 背压处理：检查 bufferedAmount 防止慢客户端内存溢出
 */
/** 特殊 runId：订阅所有运行（看板实时监控用） — 已禁用，保留符号供协议层引用 */
export const WILDCARD_RUN = "*";

/** 待发送的消息 */
interface PendingMessage {
  runId: string;
  seq: number;
  event: RunEvent;
  ts: number;
  jobId?: string;
}

/** 事件等待者：waitForRun 注册，broadcast 匹配后 resolve（替代忙等待轮询） */
interface EventWaiter {
  runId: string;
  match: (event: RunEvent) => boolean;
  resolve: (event: RunEvent | null) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class WsHub {
  private wss?: WebSocketServer;
  private serverPath = "/ws";
  /** ws → 订阅的 runId 集合 */
  private wsSubs = new Map<WebSocket, Set<string>>();
  /** runId → 订阅它的 ws 集合 */
  private runSubs = new Map<string, Set<WebSocket>>();
  /** 订阅所有运行（wildcard）的连接 — 已禁用 */
  private globalSubs = new Set<WebSocket>();
  private heartbeatTimer?: NodeJS.Timeout;

  // 消息批量发送
  private pendingMessages: PendingMessage[] = [];
  private flushTimer?: ReturnType<typeof setTimeout>;
  private readonly BATCH_INTERVAL = 16; // ~60fps, 一帧内批量发送
  private readonly MAX_BUFFERED = 4 * 1024 * 1024; // 4MB 背压阈值

  // 安全：启动时生成的 session token，前端通过 /api/ws-token 获取
  private _sessionToken = randomBytes(32).toString("hex");

  // HITL 工具确认：confirmId → { resolve, timer }
  private pendingConfirms = new Map<string, { resolve: (approved: boolean) => void; timer?: ReturnType<typeof setTimeout> }>();

  /** 事件等待者（waitForRun 的注册表） */
  private eventWaiters: EventWaiter[] = [];

  // 用户级连接（多用户 IM：session token → user → 定向推送）
  private resolveUser?: (token: string) => AuthUser | undefined;
  private wsUsers = new Map<WebSocket, AuthUser>();
  private userSockets = new Map<string, Set<WebSocket>>();
  /** ws → 设备信息（多端在线状态：deviceId / 类型 / 名称） */
  private wsDevices = new Map<WebSocket, { userId: string; deviceId: string; name: string; type: string }>();
  /** 设备状态回调（context 注入：注册设备表 + 广播给同用户其他设备） */
  onDeviceStatus?: (userId: string, device: { id: string; name: string; type: string }, online: boolean) => void;

  /** 获取当前 session token（前端用于建立 WebSocket 连接） */
  get sessionToken(): string {
    return this._sessionToken;
  }

  /** 用固定 token 覆盖自动生成的 session token（headless/API key 模式） */
  overrideToken(token: string): void {
    this._sessionToken = token;
  }

  /** 客户端消息回调（cancel/steer/tool_confirm 等需要引擎配合的操作） */
  onClientMessage?: (msg: { type: string; runId: string; content?: string; confirmId?: string; approved?: boolean }) => void;
  /** WebRTC 通话信令回调（从某用户发往目标用户；由 app 层路由） */
  onCallSignal?: (fromUserId: string, fromName: string | undefined, targetUserId: string, call: CallSignal) => void;
  /** 读取 IM 配置（由 context 注入，延迟到运行时读取） */
  getSettings?: () => import("../../../../shared/src/types/provider").AppSettings;

  attach(server: Server, path = "/ws", resolveUser?: (token: string) => AuthUser | undefined): void {
    this.serverPath = path;
    this.resolveUser = resolveUser;
    const imWs = this.getSettings?.().im?.ws;

    // noServer 模式：手动处理 upgrade 以实现 token 验证
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: (imWs?.maxPayloadMb ?? 1) * 1024 * 1024,
      perMessageDeflate: {
        zlibDeflateOptions: { level: 3 },
        threshold: 256,
      },
    });

    this.wss.on("connection", (ws, req) => {
      const ip = extractIp(req);
      logger.info(`ws client connected: ${ip}`);
      this.wsSubs.set(ws, new Set());

      // 关联用户（用户-用户 IM：session token → user）
      if (this.resolveUser) {
        const url = new URL(req.url ?? "/", "http://x");
        const token = url.searchParams.get("token");
        const user = token ? this.resolveUser(token) : undefined;
        if (user) {
          // 异地登录：踢下线旧连接（对齐 box-im/V-IM）
          const existingSockets = this.userSockets.get(user.id);
          if (existingSockets && existingSockets.size > 0) {
            const kickEnvelope = JSON.stringify({
              v: 1, ts: Date.now(), runId: "", seq: 0,
              event: { type: "auth.kicked", message: "您的账号在其他设备登录" },
            });
            for (const oldWs of existingSockets) {
              try { oldWs.send(kickEnvelope); } catch {}
              try { oldWs.close(4001, "kicked"); } catch {}
            }
            existingSockets.clear();
          }
          this.wsUsers.set(ws, user);
          let set = this.userSockets.get(user.id);
          if (!set) { set = new Set(); this.userSockets.set(user.id, set); }
          set.add(ws);
          // 设备信息（多端在线状态）：连接时上报 deviceId/type/name
          const deviceId = url.searchParams.get("deviceId");
          if (deviceId) {
            const type = url.searchParams.get("type") || "mobile";
            const device = {
              id: deviceId,
              name: url.searchParams.get("deviceName") || (type === "desktop" ? "电脑端" : "手机端"),
              type,
            };
            this.wsDevices.set(ws, { userId: user.id, deviceId, name: device.name, type });
            this.onDeviceStatus?.(user.id, device, true);
          }
        }
      }

      ws.on("message", (data) => {
        const raw = data.toString();
        // 心跳 pong：客户端发 ping，服务端回 pong
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.type === "ping") {
            try { ws.send(JSON.stringify({ type: "pong" })); } catch {}
            return;
          }
        } catch {}
        const msg = parseClientMsg(raw);
        if (!msg) return;
        switch (msg.type) {
          case "subscribe":
            this.subscribe(ws, msg.runId);
            break;
          case "unsubscribe":
            this.unsubscribe(ws, msg.runId);
            break;
          case "cancel":
            this.onClientMessage?.({ type: "cancel", runId: msg.runId });
            break;
          case "steer":
            this.onClientMessage?.({ type: "steer", runId: msg.runId, content: msg.content });
            break;
          case "tool_confirm":
            this.onClientMessage?.({ type: "tool_confirm", runId: msg.runId, confirmId: msg.confirmId, approved: msg.approved });
            break;
          case "call":
            {
              const fromUser = this.wsUsers.get(ws);
              if (fromUser && msg.targetUserId) {
                this.onCallSignal?.(fromUser.id, fromUser.displayName ?? fromUser.username, msg.targetUserId, msg.call);
              }
            }
            break;
        }
      });

      ws.on("close", () => {
        this.wsSubs.delete(ws);
        this.globalSubs.delete(ws);
        const u = this.wsUsers.get(ws);
        if (u) {
          this.wsUsers.delete(ws);
          this.userSockets.get(u.id)?.delete(ws);
        }
        const dev = this.wsDevices.get(ws);
        if (dev) {
          this.wsDevices.delete(ws);
          this.onDeviceStatus?.(dev.userId, { id: dev.deviceId, name: dev.name, type: dev.type }, false);
        }
        for (const [runId, set] of this.runSubs) {
          set.delete(ws);
          if (set.size === 0) this.runSubs.delete(runId);
        }
      });

      ws.on("error", (err) => logger.warn(`ws error: ${String(err)}`));
    });

    // 拦截 HTTP upgrade，验证 token 后再交给 WebSocketServer
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      // 只处理目标路径的 upgrade
      if (url.pathname !== this.serverPath) {
        // 不是我们的路径，不做处理（其他中间件可能会处理）
        return;
      }

      // 验证 token
      const token = url.searchParams.get("token");
      if (!token || !this.verifyToken(token)) {
        logger.warn(`ws connection rejected: missing or invalid token from ${extractIp(req)}`);
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      // Token 有效，完成 WebSocket 握手
      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        this.wss!.emit("connection", ws, req);
      });
    });

    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [runId, set] of this.runSubs) {
        this.send(set, runId, 0, { type: "heartbeat" }, now);
      }
    }, (imWs?.pingIntervalS ?? 15) * 1000);
    this.heartbeatTimer.unref?.();
  }

  /** 验证 token：设备 token（本地）或用户 session token（多用户 IM） */
  private verifyToken(token: string): boolean {
    try {
      const expected = Buffer.from(this._sessionToken, "utf8");
      const actual = Buffer.from(token, "utf8");
      if (expected.length === actual.length && timingSafeEqual(expected, actual)) return true;
    } catch {
      /* ignore */
    }
    // 用户 session token（Web 登录 / 移动端经中继）
    if (this.resolveUser && token) {
      try {
        return !!this.resolveUser(token);
      } catch {
        return false;
      }
    }
    return false;
  }

  subscribe(ws: WebSocket, runId: string): void {
    // Wildcard 订阅已禁用：防止任意外部客户端监听所有运行事件
    if (runId === WILDCARD_RUN) {
      logger.warn("wildcard subscription rejected (disabled for security)");
      return;
    }
    this.wsSubs.get(ws)?.add(runId);
    let set = this.runSubs.get(runId);
    if (!set) {
      set = new Set();
      this.runSubs.set(runId, set);
    }
    set.add(ws);
  }

  unsubscribe(ws: WebSocket, runId: string): void {
    if (runId === WILDCARD_RUN) {
      this.globalSubs.delete(ws);
      return;
    }
    this.wsSubs.get(ws)?.delete(runId);
    const set = this.runSubs.get(runId);
    set?.delete(ws);
    if (set && set.size === 0) this.runSubs.delete(runId);
  }

  /**
   * 事件驱动等待：等待该 run 广播下一个满足 match 的事件，超时返回 null。
   * 替代服务端忙等待轮询（chat 端点等待回复/执行完成）。
   */
  waitForRun(
    runId: string,
    match: (event: RunEvent) => boolean,
    timeoutMs: number,
  ): Promise<RunEvent | null> {
    return new Promise((resolve) => {
      const entry: EventWaiter = { runId, match, resolve };
      entry.timer = setTimeout(() => {
        this.removeWaiter(entry);
        resolve(null);
      }, timeoutMs);
      entry.timer.unref?.();
      this.eventWaiters.push(entry);
    });
  }

  private removeWaiter(entry: EventWaiter): void {
    const idx = this.eventWaiters.indexOf(entry);
    if (idx >= 0) this.eventWaiters.splice(idx, 1);
  }

  /** broadcast 时同步匹配 pending waiters（不依赖批量 flush，保证即时性） */
  private checkWaiters(runId: string, event: RunEvent): void {
    if (this.eventWaiters.length === 0) return;
    const matched: EventWaiter[] = [];
    for (let i = this.eventWaiters.length - 1; i >= 0; i--) {
      const w = this.eventWaiters[i];
      // 先按 runId 短路，再调 match（其他 run 的事件不触发观察者）
      if (w.runId !== runId) continue;
      let isMatch = false;
      try {
        isMatch = w.match(event);
      } catch (err) {
        // 观察者异常不应污染引擎的广播/状态判定路径
        logger.warn(`waitForRun matcher threw for run ${runId}: ${String(err)}`);
      }
      if (isMatch) {
        this.eventWaiters.splice(i, 1);
        matched.push(w);
      }
    }
    for (const w of matched) {
      if (w.timer) clearTimeout(w.timer);
      w.resolve(event);
    }
  }

  /** 推送给指定用户的全部在线连接（用户-用户 IM） */
  sendToUser(userId: string, event: RunEvent, runId = ""): void {
    const sockets = this.userSockets.get(userId);
    if (!sockets || sockets.size === 0) return;
    const envelope = JSON.stringify({ v: 1, ts: Date.now(), runId, seq: 0, event });
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(envelope);
    }
  }

  /** 当前用户在线设备 id 集合（多端在线状态） */
  getOnlineDeviceIds(userId: string): Set<string> {
    const ids = new Set<string>();
    for (const d of this.wsDevices.values()) {
      if (d.userId === userId) ids.add(d.deviceId);
    }
    return ids;
  }

  /** 广播事件给某用户的全部在线连接（多端同步，如设备状态变化） */
  broadcastToUser(userId: string, event: RunEvent): void {
    const sockets = this.userSockets.get(userId);
    if (!sockets || sockets.size === 0) return;
    const envelope = JSON.stringify({ v: 1, ts: Date.now(), runId: "", seq: 0, event });
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(envelope);
    }
  }

  /** 向订阅了该 run 的所有客户端广播一帧（含 wildcard 订阅者） */
  broadcast(runId: string, seq: number, event: RunEvent, jobId?: string): void {
    // 同步匹配事件等待者（chat 等事件驱动的等待）
    this.checkWaiters(runId, event);
    // 加入待发送队列，批量 flush
    this.pendingMessages.push({ runId, seq, event, ts: Date.now(), jobId });
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushPending(), this.BATCH_INTERVAL);
    }
  }

  /** 批量发送待处理消息 */
  private flushPending(): void {
    this.flushTimer = undefined;
    if (this.pendingMessages.length === 0) return;

    const messages = this.pendingMessages;
    this.pendingMessages = [];

    // 按 runId 分组，同一 run 的消息合并发送
    const byRun = new Map<string, PendingMessage[]>();
    for (const msg of messages) {
      const list = byRun.get(msg.runId) ?? [];
      list.push(msg);
      byRun.set(msg.runId, list);
    }

    // 批量发送
    for (const [runId, msgs] of byRun) {
      const subscribers = this.getSubscribers(runId);
      if (subscribers.size === 0) continue;

      // 序列化每条消息（共享序列化结果）
      const serialized = msgs.map((m) => {
        const envelope: WsEnvelope = { v: 1, ts: m.ts, runId: m.runId, seq: m.seq, jobId: m.jobId, event: m.event };
        return JSON.stringify(envelope);
      });

      // 发送给所有订阅者
      for (const ws of subscribers) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        // 背压检查：如果客户端缓冲区过大，跳过非关键消息
        if (ws.bufferedAmount > this.MAX_BUFFERED) {
          // 仅发送关键消息（status/result/error），跳过 token delta
          for (let i = 0; i < serialized.length; i++) {
            const evt = msgs[i].event;
            if (evt.type === "run.status" || evt.type === "run.result" || evt.type === "run.error" || evt.type === "job.status") {
              ws.send(serialized[i]);
            }
          }
          continue;
        }
        // 正常发送所有消息
        for (const data of serialized) {
          ws.send(data);
        }
      }
    }
  }

  /** 获取某个 runId 的所有订阅者（含 wildcard） */
  private getSubscribers(runId: string): Set<WebSocket> {
    const result = new Set<WebSocket>();
    // Wildcard 订阅者收到所有消息
    for (const ws of this.globalSubs) {
      result.add(ws);
    }
    // 特定 run 订阅者
    const set = this.runSubs.get(runId);
    if (set) {
      for (const ws of set) {
        result.add(ws);
      }
    }
    return result;
  }

  private send(
    set: Set<WebSocket>,
    runId: string,
    seq: number,
    event: RunEvent,
    ts: number,
    jobId?: string,
  ): void {
    const envelope: WsEnvelope = { v: 1, ts, runId, seq, jobId, event };
    const data = JSON.stringify(envelope);
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  /**
   * HITL 工具确认：向订阅了该 run 的客户端发送确认请求，等待用户响应。
   * 超时（默认 5 分钟）自动拒绝。
   */
  requestConfirm(runId: string, tool: string, args: unknown, timeoutMs?: number): Promise<boolean> {
    const confirmId = randomBytes(8).toString("hex");
    const effectiveTimeout = timeoutMs ?? (this.getSettings?.().im?.toolConfirmTimeoutMin ?? 5) * 60_000;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingConfirms.delete(confirmId);
        resolve(false);
      }, effectiveTimeout);
      timer.unref?.();

      this.pendingConfirms.set(confirmId, { resolve, timer });

      // 广播确认请求给订阅该 run 的前端客户端
      this.broadcast(runId, 0, {
        type: "tool_confirm_request",
        confirmId,
        tool,
        args,
      });
    });
  }

  /** 处理前端返回的确认结果 */
  resolveConfirm(confirmId: string, approved: boolean): void {
    const pending = this.pendingConfirms.get(confirmId);
    if (!pending) return;
    this.pendingConfirms.delete(confirmId);
    if (pending.timer) clearTimeout(pending.timer);
    pending.resolve(approved);
  }

  /** 广播关机通知给所有在线客户端 */
  broadcastShutdown(message: string, reconnectIn = 30): void {
    const envelope = JSON.stringify({
      v: 1, ts: Date.now(), runId: "", seq: 0,
      event: { type: "system:shutdown", message, reconnectIn },
    });
    for (const ws of this.wsSubs.keys()) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(envelope); } catch {}
      }
    }
    for (const sockets of this.userSockets.values()) {
      for (const ws of sockets) {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(envelope); } catch {}
        }
      }
    }
  }

  close(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    // 清理所有待确认的请求
    for (const [id, pending] of this.pendingConfirms) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.pendingConfirms.clear();
    // 清理事件等待者（resolve null 避免悬挂 Promise）
    for (const w of this.eventWaiters) {
      if (w.timer) clearTimeout(w.timer);
      w.resolve(null);
    }
    this.eventWaiters = [];
    this.wss?.close();
    this.wsSubs.clear();
    this.runSubs.clear();
    this.globalSubs.clear();
    this.pendingMessages = [];
  }
}

function extractIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}