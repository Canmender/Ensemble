import type { AgentTool, ToolContext } from "./types";
import type { MemoryBackend } from "../memory/backend";

/**
 * 显式记忆工具（agent 自主管理记忆，2026 harness 最佳实践）：
 * memory_write / memory_read / memory_list，让 agent 决定何时持久化、检索记忆。
 */
export function makeMemoryTools(
  getBackend: () => MemoryBackend | undefined,
): AgentTool[] {
  return [
    {
      name: "memory_write",
      description:
        "Write a fact to long-term memory (persists across tasks). Use for user preferences, decisions, key facts, and completed work worth remembering.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "the fact / preference / decision to remember" },
        },
        required: ["content"],
      },
      async execute(input: unknown, ctx: ToolContext): Promise<string> {
        const backend = getBackend();
        if (!backend?.enabled) return "(memory disabled)";
        const { content } = (input ?? {}) as { content?: string };
        if (!content) return "error: content required";
        await backend.add(ctx.agentId, `[agent 记录] ${content}`);
        return "remembered";
      },
    },
    {
      name: "memory_read",
      description:
        "Search your long-term memories relevant to a query (semantic/full-text). Use before acting on prior context.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "what to recall" },
        },
        required: ["query"],
      },
      async execute(input: unknown, ctx: ToolContext): Promise<string> {
        const backend = getBackend();
        if (!backend?.enabled) return "(memory disabled)";
        const { query } = (input ?? {}) as { query?: string };
        if (!query) return "error: query required";
        const results = await backend.search(ctx.agentId, query, 5);
        return results.length ? results.join("\n\n") : "(no relevant memories)";
      },
    },
    {
      name: "memory_list",
      description: "List your recent long-term memory entries.",
      parameters: { type: "object", properties: {} },
      async execute(_input: unknown, ctx: ToolContext): Promise<string> {
        const backend = getBackend();
        if (!backend?.listByAgent) return "(memory backend unavailable)";
        const entries = backend.listByAgent(ctx.agentId, 20);
        return entries.length
          ? entries.map((e) => `- ${e.content.slice(0, 300)}`).join("\n")
          : "(no memories yet)";
      },
    },
  ];
}
