import type { AppSettings } from "@multiagent/shared";
import type { ToolRegistry } from "./types";
import { fileTools } from "./file";
import { webTools } from "./web";
import { utilityTools } from "./utility";
import { makeExecuteCommandTool } from "./code";

/** 注册内置工具集（可插拔：按 agent 配置启用的工具名过滤） */
export function registerBuiltinTools(
  registry: ToolRegistry,
  getSettings: () => AppSettings,
): void {
  const settings = getSettings();
  for (const t of fileTools) registry.register(t);
  for (const t of webTools) registry.register(t);
  for (const t of utilityTools) registry.register(t);
  registry.register(
    makeExecuteCommandTool({ confirm: settings.codeExecutionConfirm ?? "ask" }),
  );
}

export type { AgentTool, ToolContext } from "./types";
