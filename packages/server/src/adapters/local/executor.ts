import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

/** 转义 prompt 中的 shell 特殊字符（arg 模式防注入） */
function escapeShellArg(s: string): string {
  if (process.platform === "win32") {
    // cmd：^ 转义特殊字符
    return s.replace(/[&|<>^()%!"\r\n]/g, "^$&");
  }
  // POSIX：单引号包裹，内部引号转义
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
import type { AgentConfig, AgentTaskInput, AgentEvent } from "@ensemble/shared";
import type { AgentAdapter } from "../types";
import { logger } from "../../util/logger";

/**
 * 本地命令 Agent 适配器：快速接入本地已有的 agent CLI / 脚本。
 * 配置 command（shell 命令）+ prompt 传递方式（stdin 或 arg）。
 */
export class LocalAgentExecutor implements AgentAdapter {
  readonly kind = "local" as const;
  private cfg: AgentConfig;
  private child?: ChildProcess;
  private cancelled = false;

  constructor(cfg: AgentConfig) {
    this.cfg = cfg;
  }

  get capabilities() {
    return this.cfg.capabilities;
  }

  async *startTask(input: AgentTaskInput): AsyncGenerator<AgentEvent> {
    const local = this.cfg.local;
    if (!local) {
      yield { type: "error", message: "agent has no local command configured", ts: Date.now() };
      yield { type: "done", outcome: "error", result: "no local command", ts: Date.now() };
      return;
    }

    yield { type: "status", status: "starting", detail: local.command, ts: Date.now() };

    const args = [...(local.args ?? [])];
    const promptArg = escapeShellArg(input.prompt);
    if ((local.promptMode ?? "arg") === "arg") args.push(promptArg);

    // 拆分命令为可执行 + 固定参数；shell:false 用 argv 数组传参（prompt 已转义防注入）
    const parts = local.command.trim().split(/\s+/);
    const bin = parts[0];
    const fixedArgs = parts.slice(1);
    const allArgs = [...fixedArgs, ...args];

    // .cmd/.bat 需经 cmd.exe /c（仍传 argv，prompt 已转义）
    const isBatch = /\.(cmd|bat)$/i.test(bin);
    const argv = isBatch ? ["cmd.exe", "/c", bin, ...allArgs] : [bin, ...allArgs];
    const child = spawn(argv[0], argv.slice(1), {
      cwd: local.cwd ?? input.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;

    // 超时强杀
    let timer: NodeJS.Timeout | undefined;
    if (local.timeoutMs) {
      timer = setTimeout(() => this.killTree(child.pid), local.timeoutMs);
      timer.unref?.();
    }

    if (local.promptMode === "stdin") {
      try {
        child.stdin?.write(input.prompt);
        child.stdin?.end();
      } catch {
        /* ignore */
      }
    }

    let out = "";
    let errText = "";

    try {
      const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });
      for await (const line of rl) {
        if (this.cancelled || input.signal?.aborted) break;
        out += line + "\n";
        yield { type: "output", kind: "text", text: line + "\n", ts: Date.now() };
      }
      for await (const line of createInterface({ input: child.stderr!, crlfDelay: Infinity })) {
        errText += line + "\n";
      }

      // 取消/abort 时不等待子进程 close（避免挂起），直接进入 cancelled 分支
      const code = this.cancelled || input.signal?.aborted
        ? null
        : await new Promise<number | null>((resolve) => {
            child.on("close", resolve);
            child.on("error", (e) => {
              logger.error(`local agent process error`, String(e));
              resolve(null);
            });
          });

      if (this.cancelled || input.signal?.aborted) {
        yield { type: "status", status: "cancelled", ts: Date.now() };
        yield { type: "done", outcome: "cancelled", result: "cancelled by user", ts: Date.now() };
      } else if (code === 0) {
        yield { type: "status", status: "success", ts: Date.now() };
        yield { type: "done", outcome: "success", result: out.trim(), ts: Date.now() };
      } else {
        const msg = errText.trim() || `local agent exited with code ${code}`;
        yield { type: "error", message: msg, ts: Date.now() };
        yield { type: "done", outcome: "error", result: msg, ts: Date.now() };
      }
    } finally {
      if (timer) clearTimeout(timer);
      this.child = undefined;
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    if (this.child?.pid) this.killTree(this.child.pid);
  }

  async dispose(): Promise<void> {
    await this.cancel();
  }

  private killTree(pid?: number): void {
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
}
