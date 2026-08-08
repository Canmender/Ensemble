import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { logger } from "../../util/logger";

export interface NativeMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP server 客户端封装：连接、listTools、callTool、close */
export class McpToolClient {
  private client = new Client({ name: "multiagent", version: "0.1.0" });
  private transport?: { close(): Promise<void> };
  private tools: NativeMcpTool[] = [];

  constructor(readonly serverId: string) {}

  async connect(cfg: { transport: "stdio" | "http"; command?: string; args?: string[]; env?: Record<string, string>; cwd?: string; url?: string; headers?: Record<string, string>; connectTimeoutMs?: number }): Promise<void> {
    const timeoutMs = cfg.connectTimeoutMs ?? 15_000;

    if (cfg.transport === "stdio") {
      if (!cfg.command) throw new Error("stdio MCP requires command");
      this.transport = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args,
        env: cfg.env,
        cwd: cfg.cwd,
        stderr: "pipe",
      });
    } else {
      if (!cfg.url) throw new Error("http MCP requires url");
      this.transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
        requestInit: cfg.headers ? { headers: cfg.headers } : undefined,
      });
    }

    await withTimeout(this.client.connect(this.transport as any), timeoutMs);

    const toolsRes = await this.client.listTools();
    this.tools = (toolsRes.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
    }));
  }

  listNativeTools(): NativeMcpTool[] {
    return this.tools;
  }

  async callTool(name: string, args: unknown): Promise<string> {
    const res = await this.client.callTool({ name, arguments: (args ?? {}) as Record<string, unknown> });
    const parts: string[] = [];
    const content = Array.isArray(res.content) ? res.content : [];
    for (const c of content) {
      if (c.type === "text") parts.push(c.text);
      else parts.push(JSON.stringify(c));
    }
    const text = parts.join("\n");
    return res.isError ? `[MCP error] ${text}` : text;
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      /* ignore */
    }
    try {
      await this.transport?.close();
    } catch {
      /* ignore */
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`mcp connect timed out after ${ms}ms`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}
