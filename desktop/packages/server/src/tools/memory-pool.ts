/**
 * 记忆池工具
 *
 * 提供给 Agent 的记忆池交互工具:
 * - memory_pool_write: 写入记忆 (显式/隐式)
 * - memory_pool_read: 读取记忆
 * - memory_pool_search: 搜索记忆
 * - memory_pool_list: 列出记忆
 */

import type { AgentTool, ToolContext } from "./types";
import { MemoryPoolManager } from "../memory/pool";

/**
 * 创建记忆池写入工具
 */
export function createMemoryPoolWriteTool(poolManager: MemoryPoolManager): AgentTool {
  return {
    name: "memory_pool_write",
    description: `写入记忆到记忆池。

显式记忆池: 长期保存，可在"记忆"页面查看，适合重要结论、偏好、约束。
隐式记忆池: 项目内共享，其他 Agent 可见，适合中间结果、关键发现、共享上下文。

记忆类型:
- fact: 事实
- preference: 偏好
- constraint: 约束
- event: 事件
- insight: 洞察/发现
- summary: 摘要`,
    parameters: {
      type: "object",
      properties: {
        pool: {
          type: "string",
          enum: ["explicit", "implicit"],
          description: "记忆池类型: explicit (长期) 或 implicit (项目共享)",
        },
        content: {
          type: "string",
          description: "记忆内容",
        },
        type: {
          type: "string",
          enum: ["fact", "preference", "constraint", "event", "insight", "summary"],
          description: "记忆类型",
          default: "insight",
        },
        importance: {
          type: "number",
          description: "重要度 (0-1)，默认 0.7",
          default: 0.7,
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "标签列表，便于分类和检索",
        },
        scope: {
          type: "string",
          description: "作用域 (隐式记忆池必填，通常是 runId 或 projectId)",
        },
      },
      required: ["pool", "content"],
    },
    execute: async (input, ctx) => {
      const { pool, content, type = "insight", importance = 0.7, tags = [], scope } = input as any;

      if (!content?.trim()) {
        return "错误: 内容不能为空";
      }

      // 自动评估重要度 (如果用户未指定)
      const finalImportance = importance ?? MemoryPoolManager.evaluateImportance(content);

      if (pool === "explicit") {
        const entry = poolManager.addExplicit({
          agentId: ctx.agentId,
          type,
          content,
          importance: finalImportance,
          tags,
          scope: "global",
        });
        return `✅ 已写入显式记忆池\nID: ${entry.id}\n类型: ${type}\n重要度: ${finalImportance.toFixed(2)}\n内容: ${content.slice(0, 100)}...`;
      } else {
        const scopeId = scope ?? `run_${Date.now()}`;
        const entry = poolManager.addImplicit({
          agentId: ctx.agentId,
          type,
          content,
          importance: finalImportance,
          tags,
          scope: scopeId,
        });

        if (!entry) {
          return `⚠️ 内容重要度 (${finalImportance.toFixed(2)}) 低于阈值，未写入隐式记忆池`;
        }

        return `✅ 已写入隐式记忆池\nScope: ${scopeId}\n类型: ${type}\n重要度: ${finalImportance.toFixed(2)}\n其他 Agent 可在同一项目内看到此记忆`;
      }
    },
  };
}

/**
 * 创建记忆池读取工具
 */
export function createMemoryPoolReadTool(poolManager: MemoryPoolManager): AgentTool {
  return {
    name: "memory_pool_read",
    description: `从记忆池读取记忆。

显式记忆池: 读取往期重要记忆 (长期保存)。
隐式记忆池: 读取项目内其他 Agent 共享的上下文。`,
    parameters: {
      type: "object",
      properties: {
        pool: {
          type: "string",
          enum: ["explicit", "implicit"],
          description: "记忆池类型",
        },
        query: {
          type: "string",
          description: "搜索关键词 (可选，不填则返回最新记忆)",
        },
        scope: {
          type: "string",
          description: "作用域 (隐式记忆池必填)",
        },
        limit: {
          type: "number",
          description: "返回条数，默认 10",
          default: 10,
        },
      },
      required: ["pool"],
    },
    execute: async (input, ctx) => {
      const { pool, query, scope, limit = 10 } = input as any;

      if (pool === "explicit") {
        const memories = query
          ? poolManager.searchExplicit(ctx.agentId, query, limit)
          : poolManager.listExplicit(ctx.agentId, limit);

        if (memories.length === 0) {
          return query ? `未找到与"${query}"相关的显式记忆` : "显式记忆池为空";
        }

        return `📋 显式记忆池 (${memories.length} 条):\n\n${memories
          .map((m, i) => {
            const tags = m.tags.length ? ` [${m.tags.join(", ")}]` : "";
            return `${i + 1}. [${m.type}]${tags} (重要度: ${m.importance.toFixed(2)})\n   ${m.content}`;
          })
          .join("\n\n")}`;
      } else {
        if (!scope) {
          return "错误: 隐式记忆池需要指定 scope (项目/Run ID)";
        }

        const memories = poolManager.listImplicit(scope, limit);

        if (memories.length === 0) {
          return `隐式记忆池 (scope: ${scope}) 为空`;
        }

        return `📋 隐式记忆池 (scope: ${scope}, ${memories.length} 条):\n\n${memories
          .map((m, i) => {
            const from = m.agentId !== ctx.agentId ? ` ← ${m.agentId}` : " ← 你";
            return `${i + 1}. [${m.type}]${from} (重要度: ${m.importance.toFixed(2)})\n   ${m.content}`;
          })
          .join("\n\n")}`;
      }
    },
  };
}

/**
 * 创建记忆池列表工具
 */
export function createMemoryPoolListTool(poolManager: MemoryPoolManager): AgentTool {
  return {
    name: "memory_pool_list",
    description: "列出记忆池中的记忆条目。",
    parameters: {
      type: "object",
      properties: {
        pool: {
          type: "string",
          enum: ["explicit", "implicit"],
          description: "记忆池类型",
        },
        scope: {
          type: "string",
          description: "作用域 (隐式记忆池可选)",
        },
        limit: {
          type: "number",
          description: "返回条数，默认 20",
          default: 20,
        },
      },
      required: ["pool"],
    },
    execute: async (input, ctx) => {
      const { pool, scope, limit = 20 } = input as any;

      if (pool === "explicit") {
        const memories = poolManager.listExplicit(ctx.agentId, limit);
        return JSON.stringify({
          pool: "explicit",
          agentId: ctx.agentId,
          count: memories.length,
          entries: memories.map((m) => ({
            id: m.id,
            type: m.type,
            content: m.content.slice(0, 200),
            importance: m.importance,
            tags: m.tags,
            createdAt: m.createdAt,
          })),
        }, null, 2);
      } else {
        if (!scope) {
          return "错误: 隐式记忆池需要指定 scope";
        }
        const memories = poolManager.listImplicit(scope, limit);
        return JSON.stringify({
          pool: "implicit",
          scope,
          count: memories.length,
          entries: memories.map((m) => ({
            id: m.id,
            agentId: m.agentId,
            type: m.type,
            content: m.content.slice(0, 200),
            importance: m.importance,
            tags: m.tags,
            createdAt: m.createdAt,
          })),
        }, null, 2);
      }
    },
  };
}
