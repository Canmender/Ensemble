import { spawn } from "node:child_process";
import type { AgentTool, ToolContext } from "./types";

const OUTPUT_LIMIT = 8000;

/**
 * 执行命令。Windows 用 shell 执行（含 taskkill 递归杀进程树）。
 * 通过 settings.codeExecutionConfirm 决定是否需用户确认。
 */
export function makeExecuteCommandTool(opts: { defaultConfirm?: boolean }): AgentTool {
  return {
    name: "execute_command",
    description:
      "Execute a shell command in the workspace. Returns stdout+stderr (truncated to 8KB). Timeout 60s.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "shell command to execute" },
        cwd: { type: "string", description: "working directory (default: workspace root)" },
      },
      required: ["command"],
    },
    requiresConfirmation: opts.defaultConfirm !== false,
    async execute(input: unknown, ctx: ToolContext): Promise<string> {
      const { command, cwd } = (input ?? {}) as { command?: string; cwd?: string };
      if (!command) return "error: no command";

      if (ctx.askConfirm && this.requiresConfirmation) {
        const ok = await ctx.askConfirm(this.name, { command });
        if (!ok) return "[user cancelled execution]";
      }

      return runCommand(command, cwd ?? ctx.cwd, ctx.signal);
    },
  };
}

export async function runCommand(
  command: string,
  cwd: string | undefined,
  signal?: AbortSignal,
  timeoutMs = 60_000,
): Promise<string> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      const out = [stdout, stderr].filter(Boolean).join("\n").slice(0, OUTPUT_LIMIT);
      const errMsg = code ? `\n[exit code ${code}]` : "";
      resolvePromise(out + errMsg || "(no output)");
    };

    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > OUTPUT_LIMIT) stdout = stdout.slice(-OUTPUT_LIMIT);
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > OUTPUT_LIMIT) stderr = stderr.slice(-OUTPUT_LIMIT);
    });
    child.on("close", (code) => finish(code));
    child.on("error", (err) => {
      finish(null);
      void err;
    });

    const timer = setTimeout(() => {
      killTree(child.pid);
      finish(null);
    }, timeoutMs);
    timer.unref?.();

    const onAbort = () => killTree(child.pid);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("close", () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    });
  });
}

/** Windows 上递归杀进程树，否则 python/node 子进程会泄漏 */
function killTree(pid?: number): void {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    } catch {
      /* ignore */
    }
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* ignore */
    }
  }
}
