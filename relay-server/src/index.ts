/**
 * 合鸣云端中继服务器
 *
 * 职责：
 * 1. 设备注册与发现
 * 2. 消息转发（实时）
 * 3. 离线消息暂存（设备离线时暂存，上线后推送并删除）
 *
 * 设计原则：
 * - 云端只做传输媒介，不持久化业务数据
 * - 离线消息队列是临时的，推送后立即删除
 *
 * 安全：
 * - RELAY_AUTH_KEY 可选配置：设置后 Socket.IO 握手与 /devices 均要求 Bearer token
 * - 共享密钥模型：所有可信设备配置同一 key（类似局域网密码）；
 *   未配置 key 时保持向后兼容（记录警告）
 * - 同一 deviceId 重复注册时顶替旧连接，防止串扰
 */

import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { timingSafeEqual } from "node:crypto";

// ==================== 配置 ====================

const DEFAULT_PORT = 8888;
const OFFLINE_MESSAGE_EXPIRY = 24 * 60 * 60 * 1000; // 24 小时
const MAX_OFFLINE_MESSAGES_PER_DEVICE = 100; // 每个设备最多暂存消息数

// Rate limiting 配置
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || String(15 * 60 * 1000), 10); // 默认 15 分钟
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "100", 10); // 默认 100 次

export interface RelayServerOptions {
  /** 共享认证密钥；缺省读 RELAY_AUTH_KEY，再缺省为 ""（向后兼容，不启用鉴权） */
  authKey?: string;
  /** 允许的 CORS 来源；缺省读 CORS_ORIGINS（逗号分隔，默认 *） */
  corsOrigins?: string[];
  /** 监听端口；缺省读 PORT（默认 8888） */
  port?: number;
}

export interface RelayServer {
  app: express.Express;
  httpServer: ReturnType<typeof createServer>;
  io: Server;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/** timing-safe 字符串比较，防止时序攻击 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ==================== 服务器工厂 ====================

export function createRelayServer(opts: RelayServerOptions = {}): RelayServer {
  const AUTH_KEY = opts.authKey ?? process.env.RELAY_AUTH_KEY ?? "";
  const CORS_ORIGINS =
    opts.corsOrigins ??
    (process.env.CORS_ORIGINS || "*")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const PORT = opts.port ?? parseInt(process.env.PORT || String(DEFAULT_PORT), 10);

  if (!AUTH_KEY) {
    console.warn(
      "[安全] RELAY_AUTH_KEY 未配置，设备注册与消息转发无鉴权。生产环境请设置 RELAY_AUTH_KEY。",
    );
  }

  // ==================== 速率限制 ====================

  interface RateLimitEntry {
    count: number;
    resetAt: number;
  }

  const rateLimitStore = new Map<string, RateLimitEntry>();

  /** 简单的内存速率限制中间件 */
  function rateLimiter(req: express.Request, res: express.Response, next: express.NextFunction): void {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();

    let entry = rateLimitStore.get(ip);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
      rateLimitStore.set(ip, entry);
    }

    entry.count++;

    res.setHeader("RateLimit-Limit", RATE_LIMIT_MAX);
    res.setHeader("RateLimit-Remaining", Math.max(0, RATE_LIMIT_MAX - entry.count));
    res.setHeader("RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

    if (entry.count > RATE_LIMIT_MAX) {
      res.status(429).json({
        error: "请求过于频繁，请稍后再试",
        retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      });
      return;
    }

    next();
  }

  // 每分钟清理过期的速率限制条目
  const rateLimitCleanup = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitStore.entries()) {
      if (now >= entry.resetAt) rateLimitStore.delete(ip);
    }
  }, 60 * 1000);
  rateLimitCleanup.unref?.();

  // ==================== 类型定义 ====================

  interface DeviceInfo {
    id: string;
    name: string;
    type: "desktop" | "mobile";
    socketId: string;
    connectedAt: number;
    lastSeen: number;
  }

  interface PendingMessage {
    id: string;
    from: string;
    to: string;
    data: any;
    timestamp: number;
  }

  // ==================== 状态管理 ====================

  /** 已连接设备 Map<deviceId, DeviceInfo> */
  const connectedDevices = new Map<string, DeviceInfo>();
  /** 离线消息队列 Map<deviceId, PendingMessage[]> */
  const offlineMessages = new Map<string, PendingMessage[]>();
  /** Socket 到 deviceId 的映射 Map<socketId, deviceId> */
  const socketToDevice = new Map<string, string>();

  // ==================== Express 应用 ====================

  const app = express();
  app.use(cors({ origin: CORS_ORIGINS.includes("*") ? "*" : CORS_ORIGINS }));
  app.use(express.json());
  app.use(rateLimiter);

  /** 要求 Authorization: Bearer <RELAY_AUTH_KEY>（未配置 key 时跳过，向后兼容） */
  function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
    if (!AUTH_KEY) return next();
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token || !safeEqual(token, AUTH_KEY)) {
      res.status(401).json({ error: "未授权：需要 Bearer token" });
      return;
    }
    next();
  }

  // 健康检查（公开，供连通性探测）
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      devices: connectedDevices.size,
      pendingMessages: Array.from(offlineMessages.values()).reduce(
        (sum, msgs) => sum + msgs.length,
        0,
      ),
      uptime: process.uptime(),
    });
  });

  // 获取在线设备列表（需认证，暴露设备身份信息）
  app.get("/devices", requireAuth, (_req, res) => {
    const devices = Array.from(connectedDevices.values()).map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      connectedAt: d.connectedAt,
      lastSeen: d.lastSeen,
    }));
    res.json({ devices });
  });

  // ==================== Socket.IO 服务 ====================

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: CORS_ORIGINS.includes("*") ? "*" : CORS_ORIGINS,
      methods: ["GET", "POST"],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // 握手鉴权：配置 RELAY_AUTH_KEY 时，要求 handshake.auth.token 与 key 一致
  io.use((socket, next) => {
    if (!AUTH_KEY) return next();
    const token = (socket.handshake.auth as { token?: unknown })?.token;
    if (typeof token !== "string" || !safeEqual(token, AUTH_KEY)) {
      return next(new Error("unauthorized"));
    }
    next();
  });

  io.on("connection", (socket: Socket) => {
    console.log(`[连接] 新的 Socket 连接: ${socket.id}`);

    // ==================== 设备注册 ====================

    socket.on("device:register", (data: { deviceId: string; deviceName: string; deviceType: "desktop" | "mobile" }) => {
      const { deviceId, deviceName, deviceType } = data;
      if (typeof deviceId !== "string" || !deviceId) {
        socket.emit("error", { message: "无效的设备 ID" });
        return;
      }

      console.log(`[注册] 设备: ${deviceName} (${deviceType}) ID: ${deviceId}`);

      // 同一 deviceId 已有连接：顶替旧连接（防串扰），并清理旧映射
      const existing = connectedDevices.get(deviceId);
      if (existing && existing.socketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(existing.socketId);
        socketToDevice.delete(existing.socketId);
        if (oldSocket) {
          oldSocket.emit("error", { message: "该设备已在其他连接注册，此连接已顶替" });
          oldSocket.disconnect(true);
        }
      }

      const device: DeviceInfo = {
        id: deviceId,
        name: deviceName,
        type: deviceType,
        socketId: socket.id,
        connectedAt: Date.now(),
        lastSeen: Date.now(),
      };

      connectedDevices.set(deviceId, device);
      socketToDevice.set(socket.id, deviceId);

      socket.join(`device:${deviceId}`);

      socket.emit("device:registered", {
        success: true,
        deviceId,
        serverTime: Date.now(),
      });

      socket.broadcast.emit("device:online", {
        id: deviceId,
        name: deviceName,
        type: deviceType,
        lastSeen: Date.now(),
      });

      const onlineDevices = Array.from(connectedDevices.values())
        .filter((d) => d.id !== deviceId)
        .map((d) => ({
          id: d.id,
          name: d.name,
          type: d.type,
          lastSeen: d.lastSeen,
        }));

      socket.emit("device:list", { devices: onlineDevices });

      pushOfflineMessages(deviceId);
    });

    // ==================== 消息转发 ====================

    socket.on("message", (data: { to: string; type: string; payload: any }) => {
      const fromDeviceId = socketToDevice.get(socket.id);
      if (!fromDeviceId) {
        socket.emit("error", { message: "设备未注册" });
        return;
      }

      if (!data || typeof data !== "object") {
        socket.emit("error", { message: "无效的消息格式" });
        return;
      }

      const { to, type, payload } = data;
      if (!type || typeof type !== "string") {
        socket.emit("error", { message: "消息类型不能为空" });
        return;
      }

      const fromDevice = connectedDevices.get(fromDeviceId);
      console.log(`[消息] ${fromDevice?.name} -> ${to || "广播"} 类型: ${type}`);

      const message = {
        id: uuidv4(),
        from: fromDeviceId,
        fromName: fromDevice?.name || "未知设备",
        to: to || "*",
        type,
        payload,
        timestamp: Date.now(),
      };

      if (!to || to === "*") {
        socket.broadcast.emit("message", message);
        return;
      }

      const targetDevice = connectedDevices.get(to);

      if (targetDevice) {
        io.to(`device:${to}`).emit("message", message);
        console.log(`[转发] 消息已发送到 ${targetDevice.name}`);
      } else {
        if (!offlineMessages.has(to)) {
          offlineMessages.set(to, []);
        }

        const queue = offlineMessages.get(to)!;
        if (queue.length >= MAX_OFFLINE_MESSAGES_PER_DEVICE) {
          queue.shift();
        }

        queue.push({
          id: message.id,
          from: fromDeviceId,
          to,
          data: message,
          timestamp: Date.now(),
        });
        console.log(`[离线] 消息已暂存，等待 ${to} 上线`);

        socket.emit("message:queued", {
          messageId: message.id,
          to,
          message: "目标设备离线，消息已暂存",
        });
      }
    });

    // ==================== 心跳 ====================

    socket.on("ping", () => {
      const deviceId = socketToDevice.get(socket.id);
      if (deviceId) {
        const device = connectedDevices.get(deviceId);
        if (device) {
          device.lastSeen = Date.now();
        }
      }
      socket.emit("pong", { serverTime: Date.now() });
    });

    // ==================== 断开连接 ====================

    socket.on("disconnect", (reason) => {
      const deviceId = socketToDevice.get(socket.id);
      if (!deviceId) return;

      const device = connectedDevices.get(deviceId);
      // 仅当该 deviceId 仍归属当前 socket 时才清理
      // （被顶替的旧连接断开时，新注册的设备信息不能被误删）
      if (device && device.socketId === socket.id) {
        connectedDevices.delete(deviceId);
        socketToDevice.delete(socket.id);
        console.log(`[断开] 设备 ${device.name || deviceId} 断开: ${reason}`);
        socket.broadcast.emit("device:offline", {
          deviceId,
          name: device?.name,
        });
      }
    });
  });

  // ==================== 离线消息推送 ====================

  async function pushOfflineMessages(deviceId: string): Promise<void> {
    const messages = offlineMessages.get(deviceId);
    if (!messages || messages.length === 0) return;

    console.log(`[离线消息] 推送 ${messages.length} 条消息到 ${deviceId}`);

    const device = connectedDevices.get(deviceId);
    if (!device) return;

    for (const msg of messages) {
      io.to(`device:${deviceId}`).emit("message", msg.data);
      console.log(`[离线消息] 已推送消息 ${msg.id}`);
    }

    offlineMessages.delete(deviceId);
    console.log(`[离线消息] 已清空 ${deviceId} 的离线队列`);
  }

  // ==================== 定时清理 ====================

  // 每 5 分钟清理过期的离线消息（超过 24 小时）
  const offlineCleanup = setInterval(() => {
    const now = Date.now();
    for (const [deviceId, messages] of offlineMessages.entries()) {
      const validMessages = messages.filter((msg) => now - msg.timestamp < OFFLINE_MESSAGE_EXPIRY);
      if (validMessages.length === 0) {
        offlineMessages.delete(deviceId);
      } else {
        offlineMessages.set(deviceId, validMessages);
      }
    }
  }, 5 * 60 * 1000);
  offlineCleanup.unref?.();

  // ==================== 生命周期 ====================

  const start = (): Promise<void> =>
    new Promise((resolve) => {
      httpServer.listen(PORT, "0.0.0.0", () => {
        console.log(`
╔═══════════════════════════════════════════════════════════╗
║           合鸣云端中继服务器已启动                        ║
╠═══════════════════════════════════════════════════════════╣
║  HTTP:      http://0.0.0.0:${PORT}                         ║
║  WebSocket: ws://0.0.0.0:${PORT}                           ║
║  健康检查:  http://0.0.0.0:${PORT}/health                  ║
║  设备列表:  http://0.0.0.0:${PORT}/devices                 ║
║  鉴权:      ${AUTH_KEY ? "启用 (RELAY_AUTH_KEY)" : "未启用 (RELAY_AUTH_KEY 未配置)"}${" ".repeat(Math.max(0, 16 - (AUTH_KEY ? 24 : 30)))}║
╚═══════════════════════════════════════════════════════════╝
        `);
        resolve();
      });
    });

  const stop = (): Promise<void> =>
    new Promise((resolve) => {
      io.close();
      httpServer.close(() => resolve());
    });

  return { app, httpServer, io, start, stop };
}

// ==================== 直接运行时启动 ====================

if (require.main === module) {
  const server = createRelayServer();
  server.start().catch((err) => {
    console.error("启动失败:", err);
    process.exit(1);
  });
}
