import { spawn } from "node:child_process";
import type { AgentTool, ToolContext } from "./types";

const OUTPUT_LIMIT = 8000;

export type CodeConfirm = "ask" | "always" | "never";

/**
 * 执行命令。Windows 用 shell 执行（含 taskkill 递归杀进程树）。
 * 三态确认策略：always→放行 / ask→询问 / never→直接拒绝。
 */
export function makeExecuteCommandTool(opts: { confirm: CodeConfirm }): AgentTool {
  return {
    name: "execute_command",
    description:
      "Execute a shell command in the workspace. Use to run tests, builds, or inspect the environment (e.g. 'npm test', 'git status'). Timeout 60s. Returns combined stdout+stderr truncated to 8KB, plus exit code on failure. The command runs with shell semantics on the current OS.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "shell command to execute" },
        cwd: { type: "string", description: "working directory (default: workspace root)" },
      },
      required: ["command"],
    },
    requiresConfirmation: opts.confirm === "ask",
    async execute(input: unknown, ctx: ToolContext): Promise<string> {
      const { command, cwd } = (input ?? {}) as { command?: string; cwd?: string };
      if (!command) return "error: no command";

      if (opts.confirm === "never") return "[已配置：命令执行被拒绝]";
      if (opts.confirm === "ask") {
        if (!ctx.askConfirm) return "[命令执行需要确认，但当前环境无确认界面，已拒绝]";
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
