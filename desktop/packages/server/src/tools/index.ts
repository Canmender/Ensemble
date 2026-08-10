import type { AppSettings } from "@ensemble/shared";
import type { ToolRegistry } from "./types";
import { fileTools } from "./file";
import { webTools } from "./web";
import { utilityTools } from "./utility";
import { makeExecuteCommandTool } from "./code";
import { RAGStore, createRagTool, createRagManageTool, type RAGConfig } from "./rag";

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

  // RAG 知识库工具（如果配置了）
  const ragConfig = settings.rag;
  if (ragConfig?.enabled) {
    const ragStore = new RAGStore(ragConfig);
    registry.register(createRagTool(ragStore));
    registry.register(createRagManageTool(ragStore));
  }
}

export { RAGStore, createRagTool, createRagManageTool } from "./rag";
export type { RAGConfig, Document, Chunk, SearchResult } from "./rag";
export { ApiAdapter, adapterToTools, openApiToAdapter, loadToolsFromOpenApi, getPredefinedAdapter, githubAdapter } from "./api-adapter";
export type { ApiAdapterDef, EndpointDef, AuthConfig } from "./api-adapter";
export type { AgentTool, ToolContext } from "./types";
