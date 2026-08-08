import type { AgentTool, ToolRegistry } from "../types";
import { McpToolClient } from "./client";
import type { McpConfigStore } from "./config";
import { mcpToolFullName, type McpServerConfig, type McpServerStatus } from "./types";
import { logger } from "../../util/logger";

/** MCP 管理器：连接生命周期 + 动态注册工具到 ToolRegistry */
export class McpManager {
  private clients = new Map<string, McpToolClient>();

  constructor(
    private cfgStore: McpConfigStore,
    private toolRegistry: ToolRegistry,
  ) {}

  async reload(): Promise<McpServerStatus[]> {
    const cfgs = this.cfgStore.list();
    const out: McpServerStatus[] = [];
    const seen = new Set<string>();
    for (const cfg of cfgs) {
      seen.add(cfg.id);
      if (cfg.enabled) out.push(await this.connectOrRefresh(cfg));
    }
    for (const id of [...this.clients.keys()]) {
      if (!seen.has(id)) await this.disconnect(id);
    }
    return out;
  }

  async connectOrRefresh(cfg: McpServerConfig): Promise<McpServerStatus> {
    await this.disconnect(cfg.id);
    try {
      const client = new McpToolClient(cfg.id);
      await client.connect(cfg);
      this.clients.set(cfg.id, client);
      this.registerTools(cfg, client);
      return { id: cfg.id, connected: true, toolCount: client.listNativeTools().length };
    } catch (err) {
      logger.warn(`mcp ${cfg.id} connect failed: ${String(err)}`);
      return { id: cfg.id, connected: false, error: err instanceof Error ? err.message : String(err), toolCount: 0 };
    }
  }

  async disconnect(id: string): Promise<void> {
    // 释放该 server 的工具
    for (const name of this.toolRegistry.names()) {
      if (name.startsWith(`mcp__${id}__`)) this.toolRegistry.unregister(name);
    }
    const client = this.clients.get(id);
    if (client) {
      await client.close().catch(() => {});
      this.clients.delete(id);
    }
  }

  async test(cfg: McpServerConfig): Promise<{ ok: boolean; message: string; toolCount: number }> {
    try {
      const client = new McpToolClient(cfg.id);
      await client.connect(cfg);
      const count = client.listNativeTools().length;
      await client.close();
      return { ok: true, message: `connected · ${count} tools`, toolCount: count };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err), toolCount: 0 };
    }
  }

  status(): McpServerStatus[] {
    const cfgs = this.cfgStore.list();
    return cfgs.map((c) => {
      const client = this.clients.get(c.id);
      if (!c.enabled) return { id: c.id, connected: false, error: "disabled", toolCount: 0 };
      return client
        ? { id: c.id, connected: true, toolCount: client.listNativeTools().length }
        : { id: c.id, connected: false, error: "not connected", toolCount: 0 };
    });
  }

  async dispose(): Promise<void> {
    for (const id of [...this.clients.keys()]) await this.disconnect(id);
  }

  private registerTools(cfg: McpServerConfig, client: McpToolClient): void {
    const maxTools = cfg.maxTools ?? 25;
    const cap = cfg.toolDescriptionCap ?? 300;
    const native = client.listNativeTools().sort((a, b) => a.name.localeCompare(b.name)).slice(0, maxTools);

    for (const t of native) {
      const tool: AgentTool = {
        name: mcpToolFullName(cfg.id, t.name),
        description: (t.description ?? "").slice(0, cap) || `MCP tool ${t.name}`,
        parameters: t.inputSchema ?? { type: "object", properties: {} },
        requiresConfirmation: !(cfg.autoApprove ?? []).includes(t.name),
        async execute(input) {
          return client.callTool(t.name, input);
        },
      };
      this.toolRegistry.register(tool);
    }
  }
}
