/**
 * 中继服务器管理路由
 */

import { Router } from "express";
import { hostname } from "node:os";
import type { AppContext } from "../../context";
import { relayClient } from "../relay-client";
import { logger } from "../../util/logger";

/** 生成设备 ID */
function getDeviceId(): string {
  // 使用 hostname + 随机数作为设备 ID
  const host = hostname().replace(/[^a-zA-Z0-9]/g, "-");
  return `desktop-${host}-${Date.now().toString(36)}`;
}

export function relayRouter(ctx: AppContext): Router {
  const router = Router();

  // 获取中继状态
  router.get("/status", (_req, res) => {
    res.json({
      connected: relayClient.isConnected(),
      status: relayClient.getStatus(),
    });
  });

  // 连接到中继服务器
  router.post("/connect", async (req, res) => {
    const { url, token } = req.body;

    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "请提供中继服务器地址" });
    }

    // 生成设备信息
    const deviceId = getDeviceId();
    const deviceName = hostname() || "我的电脑";

    // 配置中继客户端
    relayClient.configure({
      url,
      deviceId,
      deviceName,
      token,
    });

    // 注册消息处理器
    relayClient.onMessage((message) => {
      logger.info(`[Relay] 收到消息: ${message.type} from ${message.fromName}`);
      handleRelayMessage(ctx, message);
    });

    // 连接
    const success = await relayClient.connect();

    if (success) {
      res.json({ success: true, message: "已连接到中继服务器" });
    } else {
      res.status(500).json({ error: "无法连接到中继服务器" });
    }
  });

  // 断开连接
  router.post("/disconnect", (_req, res) => {
    relayClient.disconnect();
    res.json({ success: true, message: "已断开连接" });
  });

  // 发送消息
  router.post("/send", (req, res) => {
    const { to, type, payload } = req.body;

    if (!relayClient.isConnected()) {
      return res.status(400).json({ error: "未连接到中继服务器" });
    }

    if (to === "*" || !to) {
      relayClient.broadcast(type, payload);
    } else {
      relayClient.sendToDevice(to, type, payload);
    }

    res.json({ success: true });
  });

  return router;
}

/** 处理来自中继服务器的消息 */
function handleRelayMessage(ctx: AppContext, message: any): void {
  const { type, payload } = message;

  switch (type) {
    case "task:create":
      logger.info(`[Relay] 收到创建任务请求: ${payload.title}`);
      // TODO: 调用任务创建逻辑
      break;

    case "chat:send":
      logger.info(`[Relay] 收到聊天消息: ${payload.content}`);
      // TODO: 处理聊天消息
      break;

    case "control:command":
      logger.info(`[Relay] 收到控制命令: ${payload.command}`);
      // TODO: 处理控制命令
      break;

    case "sync:request":
      logger.info(`[Relay] 收到同步请求`);
      // TODO: 发送同步数据
      break;

    default:
      logger.debug(`[Relay] 未处理的消息类型: ${type}`);
  }
}
