import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server } from "node:http";
import { parseClientMsg, type RunEvent, type WsEnvelope } from "./protocol";
import { logger } from "../../util/logger";

/**
 * WebSocket Hub：管理客户端订阅（按 runId），广播 run 事件帧。
 * 事件先落库分配 seq，再走 hub.broadcast —— 断线重连后客户端用 afterSeq 补拉。
 */
export class WsHub {
  private wss?: WebSocketServer;
  /** ws → 订阅的 runId 集合 */
  private wsSubs = new Map<WebSocket, Set<string>>();
  /** runId → 订阅它的 ws 集合 */
  private runSubs = new Map<string, Set<WebSocket>>();
  private heartbeatTimer?: NodeJS.Timeout;

  /** 客户端消息回调（cancel 等需要引擎配合的操作） */
  onClientMessage?: (msg: { type: string; runId: string }) => void;

  attach(server: Server, path = "/ws"): void {
    this.wss = new WebSocketServer({ server, path });

    this.wss.on("connection", (ws, req) => {
      const ip = extractIp(req);
      logger.info(`ws client connected: ${ip}`);
      this.wsSubs.set(ws, new Set());

      ws.on("message", (data) => {
        const raw = data.toString();
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
        }
      });

      ws.on("close", () => {
        this.wsSubs.delete(ws);
        for (const [runId, set] of this.runSubs) {
          set.delete(ws);
          if (set.size === 0) this.runSubs.delete(runId);
        }
      });

      ws.on("error", (err) => logger.warn(`ws error: ${String(err)}`));
    });

    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [runId, set] of this.runSubs) {
        this.send(set, runId, 0, { type: "heartbeat" }, now);
      }
    }, 15_000);
    this.heartbeatTimer.unref?.();
  }

  subscribe(ws: WebSocket, runId: string): void {
    this.wsSubs.get(ws)?.add(runId);
    let set = this.runSubs.get(runId);
    if (!set) {
      set = new Set();
      this.runSubs.set(runId, set);
    }
    set.add(ws);
  }

  unsubscribe(ws: WebSocket, runId: string): void {
    this.wsSubs.get(ws)?.delete(runId);
    const set = this.runSubs.get(runId);
    set?.delete(ws);
    if (set && set.size === 0) this.runSubs.delete(runId);
  }

  /** 向订阅了该 run 的所有客户端广播一帧 */
  broadcast(runId: string, seq: number, event: RunEvent, jobId?: string): void {
    const set = this.runSubs.get(runId);
    if (!set || set.size === 0) return;
    this.send(set, runId, seq, event, Date.now(), jobId);
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

  close(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.wss?.close();
    this.wsSubs.clear();
    this.runSubs.clear();
  }
}

function extractIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}
