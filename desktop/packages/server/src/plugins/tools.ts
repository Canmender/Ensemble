/**
 * 工具系统插件化（cordis 思想首个落地消费者）。
 *
 * 把内置工具/RAG/记忆池的注册包成插件：
 * - RAG 配置变更 → unregister + register 即干净重装（effect 登记的工具自动回滚，无残留）
 * - 注册中途抛错 → 半成品工具全部撤销（此前直接写全局 registry 无此保证）
 * - 后续第三方工具包 = 一个 EnsemblePlugin，inject 声明所需服务即可挂载
 */
import type { AppSettings } from "@ensemble/shared";
import type { ToolRegistry } from "../tools/types";
import type { MemoryPoolManager } from "../memory/pool";
import type { EmbedFn } from "../tools/embedding";
import { fileTools } from "../tools/file";
import { webTools } from "../tools/web";
import { utilityTools } from "../tools/utility";
import { makeExecuteCommandTool } from "../tools/code";
import { RAGStore, createRagTool, createRagManageTool } from "../tools/rag";
import {
  createMemoryPoolWriteTool,
  createMemoryPoolReadTool,
  createMemoryPoolListTool,
} from "../tools/memory-pool";
import type { EnsemblePlugin, PluginContext } from "./kernel";

/** 内置工具集插件：文件/网络/实用工具 + 命令执行 + 记忆池 */
export function builtinToolsPlugin(deps: {
  registry: ToolRegistry;
  getSettings: () => AppSettings;
  poolManager?: MemoryPoolManager;
}): EnsemblePlugin {
  return {
    name: "builtin-tools",
    install: (ctx: PluginContext) => {
      const { registry, getSettings, poolManager } = deps;
      for (const t of fileTools) ctx.effect(() => (registry.register(t), () => registry.unregister(t.name)));
      for (const t of webTools) ctx.effect(() => (registry.register(t), () => registry.unregister(t.name)));
      for (const t of utilityTools) ctx.effect(() => (registry.register(t), () => registry.unregister(t.name)));
      const cmd = makeExecuteCommandTool({ confirm: getSettings().codeExecutionConfirm ?? "ask" });
      ctx.effect(() => (registry.register(cmd), () => registry.unregister(cmd.name)), "cmd-tool");

      if (poolManager) {
        for (const t of [
          createMemoryPoolWriteTool(poolManager),
          createMemoryPoolReadTool(poolManager),
          createMemoryPoolListTool(poolManager),
        ]) {
          ctx.effect(() => (registry.register(t), () => registry.unregister(t.name)));
        }
      }
    },
  };
}

/**
 * RAG 知识库插件：settings.rag.enabled 时挂载；配置变更由调用方重装本插件
 * （unregister → register），RAGStore 索引等资源经 effect 自动清理重建。
 */
export function ragPlugin(deps: {
  registry: ToolRegistry;
  getSettings: () => AppSettings;
  embedFn?: EmbedFn;
}): EnsemblePlugin {
  return {
    name: "rag-tools",
    inject: [],
    install: (ctx) => {
      const ragConfig = deps.getSettings().rag;
      if (!ragConfig?.enabled) return; // 未启用：空安装（active 但无副作用）
      const store = new RAGStore({ ...ragConfig, embedFn: deps.embedFn });
      for (const t of [createRagTool(store), createRagManageTool(store)]) {
        ctx.effect(() => (deps.registry.register(t), () => deps.registry.unregister(t.name)));
      }
    },
  };
}
