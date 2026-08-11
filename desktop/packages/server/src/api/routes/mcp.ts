import { Router } from "express";
import type { AppContext } from "../../context";
import { asyncH, fail, ok } from "./helpers";
import { logger } from "../../util/logger";

const now = () => new Date().toISOString();

/**
 * SECURITY: MCP server registration accepts a `command` that is executed as a
 * subprocess via StdioClientTransport. An attacker who can reach this endpoint
 * could register an arbitrary command and achieve remote code execution.
 *
 * Mitigations applied here:
 * 1. Audit-log every command registration attempt (command + args + caller IP).
 * 2. Reject obviously dangerous shell metacharacters in the command field.
 * 3. If an allowlist is configured in security settings, enforce it.
 *
 * TODO: In production, consider requiring admin authentication for this
 * endpoint and/or restricting to a hard-coded allowlist of known MCP servers.
 */

const SHELL_META_RE = /[;&|`$<>!{}()\[\]#'~]/;

/** 未配置白名单时拒绝的解释器命令（MCP stdio 是任意命令执行入口，需显式信任） */
const INTERPRETER_COMMANDS = new Set([
  "node", "npm", "npx", "python", "python3", "sh", "bash", "zsh", "fish",
  "perl", "ruby", "pwsh", "powershell", "cmd", "deno", "bun", "wsl",
]);

function validateMcpCommand(
  command: string | undefined,
  args: string[] | undefined,
  allowedCommands?: string[],
): string | undefined {
  if (!command) return "command is required for stdio transport";
  if (SHELL_META_RE.test(command)) return "command contains forbidden shell metacharacters";
  if (args?.some((a) => SHELL_META_RE.test(a))) return "args contain forbidden shell metacharacters";
  if (allowedCommands && allowedCommands.length > 0) {
    if (!allowedCommands.includes(command)) {
      return `command "${command}" is not in the allowed commands list`;
    }
  } else if (INTERPRETER_COMMANDS.has(command)) {
    // 无白名单时禁止解释器命令，防止参数注入型任意代码执行（如 python -c "..."）
    return `command "${command}" 是解释器，出于安全考虑请先在安全设置（allowedCommands）中显式允许`;
  }
  return undefined; // valid
}

export function mcpRouter(ctx: AppContext): Router {
  const r = Router();

  r.get("/", (_req, res) => {
    const status = ctx.mcpManager.status();
    const configs = ctx.mcpConfig.list().map((c) => ({
      ...c,
      status: status.find((s) => s.id === c.id),
    }));
    ok(res, configs);
  });

  r.post(
    "/",
    asyncH(async (req, res) => {
      const body = req.body ?? {};
      if (!body.id || !body.name) return fail(res, new Error("id and name required"));
      if (ctx.mcpConfig.get(body.id)) return fail(res, new Error(`mcp server exists: ${body.id}`));

      // Security: validate command and audit-log the registration
      const transport = body.transport ?? "stdio";
      if (transport === "stdio") {
        const allowedCmds = ctx.config.getSettings()?.security?.allowedCommands;
        const err = validateMcpCommand(body.command, body.args, allowedCmds);
        if (err) return fail(res, new Error(err));
        logger.warn(
          `[MCP SECURITY] Registering stdio MCP server id=${body.id} command=${body.command} args=${JSON.stringify(body.args ?? [])} ip=${req.ip}`,
        );
      }

      const cfg = ctx.mcpConfig.save({
        id: body.id,
        name: body.name,
        enabled: body.enabled ?? true,
        transport,
        command: body.command,
        args: body.args,
        env: body.env,
        cwd: body.cwd,
        url: body.url,
        headers: body.headers,
        maxTools: body.maxTools,
        toolDescriptionCap: body.toolDescriptionCap,
        autoApprove: body.autoApprove,
        connectTimeoutMs: body.connectTimeoutMs,
        createdAt: now(),
        updatedAt: now(),
      });
      const st = cfg.enabled ? await ctx.mcpManager.connectOrRefresh(cfg) : undefined;
      ok(res, { ...cfg, status: st }, 201);
    }),
  );

  r.put(
    "/:id",
    asyncH(async (req, res) => {
      const existing = ctx.mcpConfig.get(String(req.params.id));
      if (!existing) return fail(res, new Error(`mcp server not found: ${String(req.params.id)}`), 404);
      const body = req.body ?? {};

      // Security: if command is being changed, re-validate
      if (body.command !== undefined || body.args !== undefined) {
        const transport = body.transport ?? existing.transport ?? "stdio";
        if (transport === "stdio") {
          const allowedCmds = ctx.config.getSettings()?.security?.allowedCommands;
          const err = validateMcpCommand(
            body.command ?? existing.command,
            body.args ?? existing.args,
            allowedCmds,
          );
          if (err) return fail(res, new Error(err));
          logger.warn(
            `[MCP SECURITY] Updating stdio MCP server id=${existing.id} command=${body.command ?? existing.command} args=${JSON.stringify(body.args ?? existing.args ?? [])} ip=${req.ip}`,
          );
        }
      }

      const cfg = ctx.mcpConfig.save({
        ...existing,
        ...body,
        id: existing.id,
        updatedAt: now(),
      });
      const st = cfg.enabled ? await ctx.mcpManager.connectOrRefresh(cfg) : await ctx.mcpManager.disconnect(cfg.id).then(() => undefined);
      ok(res, { ...cfg, status: st });
    }),
  );

  r.delete(
    "/:id",
    asyncH(async (req, res) => {
      await ctx.mcpManager.disconnect(String(req.params.id));
      ctx.mcpConfig.delete(String(req.params.id));
      ok(res, { deleted: String(req.params.id) });
    }),
  );

  r.post(
    "/:id/test",
    asyncH(async (req, res) => {
      const cfg = ctx.mcpConfig.get(String(req.params.id));
      if (!cfg) return fail(res, new Error(`mcp server not found: ${String(req.params.id)}`), 404);
      const result = await ctx.mcpManager.test(cfg);
      ok(res, result);
    }),
  );

  r.post(
    "/:id/refresh",
    asyncH(async (req, res) => {
      const cfg = ctx.mcpConfig.get(String(req.params.id));
      if (!cfg) return fail(res, new Error(`mcp server not found: ${String(req.params.id)}`), 404);
      const st = await ctx.mcpManager.connectOrRefresh(cfg);
      ok(res, st);
    }),
  );

  return r;
}
