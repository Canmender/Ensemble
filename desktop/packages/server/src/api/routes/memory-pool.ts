/**
 * 记忆池 API 路由
 *
 * 提供显式/隐式记忆池的 CRUD 接口
 */

import { Router } from "express";
import type { AppContext } from "../../context";
import type { MemoryPoolManager } from "../../memory/pool";

export function memoryPoolRouter(ctx: AppContext): Router {
  const router = Router();
  const poolManager: MemoryPoolManager = ctx.memoryPoolManager;

  // ========== 显式记忆池 ==========

  /** 列出显式记忆 */
  router.get("/explicit", (req, res) => {
    const agentId = req.query.agentId as string;
    const limit = parseInt(req.query.limit as string) || 50;

    if (!agentId) {
      // 列出所有 agent 的显式记忆
      const agents = ctx.config.listAgents();
      const allMemories = agents.flatMap((a) => poolManager.listExplicit(a.id, limit));
      res.json(allMemories);
    } else {
      const memories = poolManager.listExplicit(agentId, limit);
      res.json(memories);
    }
  });

  /** 搜索显式记忆 */
  router.get("/explicit/search", (req, res) => {
    const agentId = req.query.agentId as string;
    const query = req.query.q as string;
    const limit = parseInt(req.query.limit as string) || 10;

    if (!agentId || !query) {
      return res.status(400).json({ error: "agentId and q are required" });
    }

    const results = poolManager.searchExplicit(agentId, query, limit);
    res.json(results);
  });

  /** 添加显式记忆 */
  router.post("/explicit", (req, res) => {
    const { agentId, type, content, importance, tags } = req.body;

    if (!agentId || !content) {
      return res.status(400).json({ error: "agentId and content are required" });
    }

    const entry = poolManager.addExplicit({
      agentId,
      type: type ?? "fact",
      content,
      importance: importance ?? 0.7,
      tags: tags ?? [],
      scope: "global",
    });

    res.json(entry);
  });

  /** 更新显式记忆 */
  router.put("/explicit/:id", (req, res) => {
    const { id } = req.params;
    const { content, type, importance, tags } = req.body;

    poolManager.updateExplicit(id, { content, type, importance, tags });
    res.json({ success: true });
  });

  /** 删除显式记忆 */
  router.delete("/explicit/:id", (req, res) => {
    const { id } = req.params;
    poolManager.deleteExplicit(id);
    res.json({ success: true });
  });

  // ========== 隐式记忆池 ==========

  /** 列出隐式记忆 (按 scope) */
  router.get("/implicit", (req, res) => {
    const scope = req.query.scope as string;
    const limit = parseInt(req.query.limit as string) || 50;

    if (!scope) {
      return res.status(400).json({ error: "scope is required" });
    }

    const memories = poolManager.listImplicit(scope, limit);
    res.json(memories);
  });

  /** 添加隐式记忆 */
  router.post("/implicit", (req, res) => {
    const { agentId, type, content, importance, tags, scope } = req.body;

    if (!agentId || !content || !scope) {
      return res.status(400).json({ error: "agentId, content, and scope are required" });
    }

    const entry = poolManager.addImplicit({
      agentId,
      type: type ?? "insight",
      content,
      importance: importance ?? 0.7,
      tags: tags ?? [],
      scope,
    });

    if (!entry) {
      return res.json({ success: false, message: "Importance below threshold" });
    }

    res.json(entry);
  });

  /** 清空 scope 的隐式记忆 */
  router.delete("/implicit/:scope", (req, res) => {
    const { scope } = req.params;
    poolManager.clearScope(scope);
    res.json({ success: true });
  });

  // ========== 统计 ==========

  /** 获取记忆池统计 */
  router.get("/stats", (_req, res) => {
    const agents = ctx.config.listAgents();
    const stats = {
      explicit: {
        total: 0,
        byAgent: {} as Record<string, number>,
      },
      implicit: {
        total: 0,
        byScope: {} as Record<string, number>,
      },
    };

    for (const agent of agents) {
      const memories = poolManager.listExplicit(agent.id, 1000);
      stats.explicit.byAgent[agent.id] = memories.length;
      stats.explicit.total += memories.length;
    }

    res.json(stats);
  });

  return router;
}
