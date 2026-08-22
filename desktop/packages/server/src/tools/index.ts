import type { AppSettings } from "@ensemble/shared";
import type { ToolRegistry } from "./types";
import type { MemoryPoolManager } from "../memory/pool";
import { fileTools } from "./file";
import { webTools } from "./web";
import { utilityTools } from "./utility";
import { makeExecuteCommandTool } from "./code";
import { RAGStore, createRagTool, createRagManageTool, type RAGConfig } from "./rag";
import { createMemoryPoolWriteTool, createMemoryPoolReadTool, createMemoryPoolListTool } from "./memory-pool";

/** 注册内置工具集（可插拔：按 agent 配置启用的工具名过滤）
 *  注：RAG 工具已迁移至 plugins/tools.ts 的 ragPlugin（插件宿主管理，可干净重装） */
export function registerBuiltinTools(
  registry: ToolRegistry,
  getSettings: () => AppSettings,
  poolManager?: MemoryPoolManager,
): void {
  const settings = getSettings();
  for (const t of fileTools) registry.register(t);
  for (const t of webTools) registry.register(t);
  for (const t of utilityTools) registry.register(t);
  registry.register(
    makeExecuteCommandTool({ confirm: settings.codeExecutionConfirm ?? "ask" }),
  );

  // 记忆池工具（始终注册）
  if (poolManager) {
    registry.register(createMemoryPoolWriteTool(poolManager));
    registry.register(createMemoryPoolReadTool(poolManager));
    registry.register(createMemoryPoolListTool(poolManager));
  }
}

export { RAGStore, createRagTool, createRagManageTool } from "./rag";
export type { RAGConfig, Document, Chunk, SearchResult } from "./rag";
export { ApiAdapter, adapterToTools, openApiToAdapter, loadToolsFromOpenApi, getPredefinedAdapter, githubAdapter } from "./api-adapter";
export type { ApiAdapterDef, EndpointDef, AuthConfig } from "./api-adapter";
export { createMemoryPoolWriteTool, createMemoryPoolReadTool, createMemoryPoolListTool } from "./memory-pool";
export type { AgentTool, ToolContext } from "./types";
