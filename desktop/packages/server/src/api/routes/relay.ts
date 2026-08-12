/**
 * 中继服务器管理路由 + 中继消息处理（移动端 IM / 遥控）。
 *
 * 自用架构：服务器只作中继。桌面端本地运行，启动时连接中继；
 * 移动端经中继与桌面端通信（IM 对话 + 任务遥控 + 状态同步）。
 */

import { Router } from "express";
import { hostname } from "node:os";
import type { AppContext } from "../../context";
import { relayClient } from "../relay-client";
import { logger } from "../../util/logger";

/** 生成设备 ID */
function getDeviceId(): string {
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

    relayClient.configure({
      url,
      deviceId: getDeviceId(),
      deviceName: hostname() || "我的电脑",
      token,
    });

    // 注册消息处理器
    relayClient.onMessage((message) => {
      logger.info(`[Relay] 收到消息: ${message.type} from ${message.fromName}`);
      void handleRelayMessage(ctx, message);
    });

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

/**
 * 启动时初始化中继客户端（自用：桌面端默认连接云端中继）。
 * 配置了 RELAY_URL 即自动连接并注册消息处理。
 */
export function initRelayClient(ctx: AppContext): void {
  if (!ctx.env.relayUrl) return;
  relayClient.configure({
    url: ctx.env.relayUrl,
    deviceId: getDeviceId(),
    deviceName: hostname() || "我的电脑",
    token: ctx.env.relayKey,
  });
  relayClient.onMessage((message) => {
    logger.info(`[Relay] 收到消息: ${message.type} from ${message.fromName}`);
    void handleRelayMessage(ctx, message);
  });
  void relayClient.connect().then((ok) => {
    logger.info(`[Relay] ${ok ? "已连接中继" : "中继连接失败"}: ${ctx.env.relayUrl}`);
  });
}

/**
 * 处理来自移动端的中继消息（经服务器中继转发）：
 * - chat:send：移动端 IM 消息 → 注入桌面端 agent 会话 → 回复转发回移动端
 * - control:command：遥控（cancel 等）
 * - task:create：移动端创建任务
 * - sync:request：同步桌面端状态
 */
async function handleRelayMessage(ctx: AppContext, message: any): Promise<void> {
  const { type, payload, from } = message ?? {};
  const send = (to: string, t: string, p: unknown) => {
    if (to) relayClient.sendToDevice(to, t, p);
  };

  switch (type) {
    case "chat:send": {
      const { runId, content } = payload ?? {};
      if (typeof content !== "string" || !content.trim()) return;

      let run = runId ? ctx.store.getRun(runId) : undefined;
      if (!run || (run.status !== "queued" && run.status !== "running")) {
        // 无活跃 run → 创建会话（用启用的 agent，最多 3 个参与群聊）
        const agents = ctx.config.listAgents().filter((a) => a.enabled);
        if (agents.length === 0) {
          send(from, "chat:message", { agentId: "system", content: "桌面端暂无可用 Agent" });
          return;
        }
        run = await ctx.engine.createAndExecuteTask(
          "移动端会话",
          {
            mode: "chat",
            prompt: content,
            participantIds: agents.slice(0, 3).map((a) => a.id),
            maxRounds: 50,
          },
          "relay",
        );
      } else {
        ctx.engine.addSteering(run.id, content);
        ctx.engine.broadcastChatMessage(run.id, undefined, "user", "user", content);
      }

      // 事件驱动等待 agent 回复 → 转发回移动端
      const reply = await ctx.hub.waitForRun(
        run.id,
        (ev) => ev.type === "chat.message" && ev.agentId !== "user",
        60_000,
      );
      if (reply && reply.type === "chat.message") {
        send(from, "chat:message", {
          runId: run.id,
          agentId: reply.agentId,
          content: reply.content,
        });
      }
      break;
    }

    case "control:command": {
      const { command, targetId, targetType } = payload ?? {};
      if (command === "cancel" && targetType === "run" && targetId) {
        ctx.engine.cancelRun(targetId);
        send(from, "control:response", { success: true, command, targetId });
      }
      break;
    }

    case "task:create": {
      const { title, input } = payload ?? {};
      if (!title) return;
      const run = await ctx.engine.createAndExecuteTask(title, input ?? {}, "relay");
      send(from, "task:created", { runId: run.id });
      break;
    }

    case "sync:request": {
      const agents = ctx.config.listAgents();
      const tasks = ctx.store.listTasks();
      const runs = ctx.store.listRuns();
      send(from, "sync:response", { agents, tasks, runs });
      break;
    }

    default:
      logger.debug(`[Relay] 未处理的消息类型: ${type}`);
  }
}
