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
 */

import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";

// ==================== 配置 ====================

const PORT = parseInt(process.env.PORT || "8888", 10);
const OFFLINE_MESSAGE_EXPIRY = 24 * 60 * 60 * 1000; // 24 小时
const MAX_OFFLINE_MESSAGES_PER_DEVICE = 100; // 每个设备最多暂存消息数

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
app.use(cors());
app.use(express.json());

// 健康检查
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    devices: connectedDevices.size,
    pendingMessages: Array.from(offlineMessages.values()).reduce(
      (sum, msgs) => sum + msgs.length,
      0
    ),
    uptime: process.uptime(),
  });
});

// 获取在线设备列表
app.get("/devices", (req, res) => {
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
    origin: "*",
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

io.on("connection", (socket: Socket) => {
  console.log(`[连接] 新的 Socket 连接: ${socket.id}`);

  // ==================== 设备注册 ====================

  socket.on("device:register", (data: { deviceId: string; deviceName: string; deviceType: "desktop" | "mobile" }) => {
    const { deviceId, deviceName, deviceType } = data;

    console.log(`[注册] 设备: ${deviceName} (${deviceType}) ID: ${deviceId}`);

    // 保存设备信息
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

    // 加入设备专属房间
    socket.join(`device:${deviceId}`);

    // 通知注册成功
    socket.emit("device:registered", {
      success: true,
      deviceId,
      serverTime: Date.now(),
    });

    // 广播设备上线
    socket.broadcast.emit("device:online", {
      id: deviceId,
      name: deviceName,
      type: deviceType,
      lastSeen: Date.now(),
    });

    // 发送当前在线设备列表
    const onlineDevices = Array.from(connectedDevices.values())
      .filter((d) => d.id !== deviceId)
      .map((d) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        lastSeen: d.lastSeen,
      }));

    socket.emit("device:list", { devices: onlineDevices });

    // 推送离线消息
    pushOfflineMessages(deviceId);
  });

  // ==================== 消息转发 ====================

  socket.on("message", (data: { to: string; type: string; payload: any }) => {
    const fromDeviceId = socketToDevice.get(socket.id);
    if (!fromDeviceId) {
      socket.emit("error", { message: "设备未注册" });
      return;
    }

    // 输入验证
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

    // 构造完整消息
    const message = {
      id: uuidv4(),
      from: fromDeviceId,
      fromName: fromDevice?.name || "未知设备",
      to: to || "*",
      type,
      payload,
      timestamp: Date.now(),
    };

    // 广播消息
    if (!to || to === "*") {
      // 广播给所有其他设备
      socket.broadcast.emit("message", message);
      console.log(`[广播] 消息已广播给所有设备`);
      return;
    }

    // 定向消息
    const targetDevice = connectedDevices.get(to);

    if (targetDevice) {
      // 目标在线，直接转发
      io.to(`device:${to}`).emit("message", message);
      console.log(`[转发] 消息已发送到 ${targetDevice.name}`);
    } else {
      // 目标离线，加入离线队列
      if (!offlineMessages.has(to)) {
        offlineMessages.set(to, []);
      }

      const queue = offlineMessages.get(to)!;

      // 检查队列大小限制
      if (queue.length >= MAX_OFFLINE_MESSAGES_PER_DEVICE) {
        // 移除最旧的消息
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

      // 通知发送者消息已暂存
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
    if (deviceId) {
      const device = connectedDevices.get(deviceId);
      console.log(`[断开] 设备 ${device?.name || deviceId} 断开: ${reason}`);

      // 清理映射
      connectedDevices.delete(deviceId);
      socketToDevice.delete(socket.id);

      // 广播设备离线
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

  // 推送所有离线消息
  for (const msg of messages) {
    io.to(`device:${deviceId}`).emit("message", msg.data);
    console.log(`[离线消息] 已推送消息 ${msg.id}`);
  }

  // 清空队列
  offlineMessages.delete(deviceId);
  console.log(`[离线消息] 已清空 ${deviceId} 的离线队列`);
}

// ==================== 定时清理 ====================

// 每 5 分钟清理过期的离线消息（超过 24 小时）
setInterval(() => {
  const now = Date.now();
  const expireTime = 24 * 60 * 60 * 1000; // 24 小时

  for (const [deviceId, messages] of offlineMessages.entries()) {
    const validMessages = messages.filter((msg) => now - msg.timestamp < expireTime);
    if (validMessages.length === 0) {
      offlineMessages.delete(deviceId);
    } else {
      offlineMessages.set(deviceId, validMessages);
    }
  }
}, 5 * 60 * 1000);

// ==================== 启动服务器 ====================

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           合鸣云端中继服务器已启动                        ║
╠═══════════════════════════════════════════════════════════╣
║  HTTP:      http://0.0.0.0:${PORT}                         ║
║  WebSocket: ws://0.0.0.0:${PORT}                           ║
║  健康检查:  http://0.0.0.0:${PORT}/health                  ║
║  设备列表:  http://0.0.0.0:${PORT}/devices                 ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

export { app, httpServer, io };
