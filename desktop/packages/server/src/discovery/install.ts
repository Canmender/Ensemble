/**
 * Agent harness 原生支持：自动安装。
 *
 * 对常用的开源 agent CLI（opencode / claude-code / codex / gemini / qwen / aider 等）
 * 提供一键自动安装（经包管理器）；对无法自动安装的（hermes / goose 等）提供手动引导。
 * 安装命令来自本模块白名单（type 由检测结果决定，不接受任意输入）。
 */

import { spawn } from "node:child_process";
import { logger } from "../util/logger";

/** 中国网络环境：npm 全局安装走 npmmirror 镜像（可经 ENSEMBLE_NPM_REGISTRY 覆盖） */
const NPM_REGISTRY = process.env.ENSEMBLE_NPM_REGISTRY ?? "https://registry.npmmirror.com";
/** pip 走阿里镜像（可经 ENSEMBLE_PIP_INDEX 覆盖） */
const PIP_INDEX = process.env.ENSEMBLE_PIP_INDEX ?? "https://mirrors.aliyun.com/pypi/simple/";

export interface HarnessInstaller {
  type: string;
  name: string;
  /** 检测命令（与 detect.ts 的 HARNESSES 一致） */
  cmd: string;
  /** 自动安装命令（空 = 需手动安装） */
  install: string;
  /** 是否支持一键自动安装 */
  autoInstallable: boolean;
}

/** 常用 harness 的安装方式（npm 全局安装；跨平台，Node 用户级 prefix 无需管理员） */
export const INSTALLERS: Record<string, HarnessInstaller> = {
  opencode: {
    type: "opencode",
    name: "OpenCode",
    cmd: "opencode",
    install: `npm install -g opencode-ai --registry=${NPM_REGISTRY}`,
    autoInstallable: true,
  },
  claude: {
    type: "claude",
    name: "Claude Code",
    cmd: "claude",
    install: `npm install -g @anthropic-ai/claude-code --registry=${NPM_REGISTRY}`,
    autoInstallable: true,
  },
  codex: {
    type: "codex",
    name: "Codex CLI",
    cmd: "codex",
    install: `npm install -g @openai/codex --registry=${NPM_REGISTRY}`,
    autoInstallable: true,
  },
  gemini: {
    type: "gemini",
    name: "Gemini CLI",
    cmd: "gemini",
    install: `npm install -g @google/gemini-cli --registry=${NPM_REGISTRY}`,
    autoInstallable: true,
  },
  qwen: {
    type: "qwen",
    name: "Qwen Code",
    cmd: "qwen",
    install: `npm install -g @qwen-code/qwen-code --registry=${NPM_REGISTRY}`,
    autoInstallable: true,
  },
  aider: {
    type: "aider",
    name: "Aider",
    cmd: "aider",
    install: `python -m pip install aider-chat -i ${PIP_INDEX}`,
    autoInstallable: true,
  },
  // 以下暂不支持一键自动安装（安装方式各异），提供手动引导
  goose: { type: "goose", name: "Goose", cmd: "goose", install: "", autoInstallable: false },
  hermes: { type: "hermes", name: "Hermes Agent", cmd: "hermes", install: "", autoInstallable: false },
  antigravity: {
    type: "antigravity",
    name: "Antigravity",
    cmd: "antigravity",
    install: "",
    autoInstallable: false,
  },
};

/**
 * 执行安装命令（spawn + 流式输出）。
 * @param type harness 类型（必须是 INSTALLERS 白名单内的 key）
 * @param onOutput 安装过程输出回调（供前端展示进度）
 */
export function installHarness(
  type: string,
  onOutput?: (line: string) => void,
): Promise<{ ok: boolean; error?: string }> {
  const inst = INSTALLERS[type];
  if (!inst) return Promise.resolve({ ok: false, error: `未知 harness: ${type}` });
  if (!inst.install) {
    return Promise.resolve({ ok: false, error: `${inst.name} 暂不支持一键安装，请参考其官方文档手动安装` });
  }

  logger.info(`[install] installing ${inst.name}: ${inst.install}`);
  return new Promise((resolve) => {
    const child = spawn(inst.install, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d: Buffer) => {
      const line = d.toString();
      onOutput?.(line);
      logger.debug(`[install] ${inst.type}: ${line.trim()}`);
    });
    child.stderr.on("data", (d: Buffer) => {
      const line = d.toString();
      onOutput?.(line);
      logger.debug(`[install] ${inst.type} (stderr): ${line.trim()}`);
    });
    child.on("close", (code) => {
      logger.info(`[install] ${inst.name} finished with exit ${code}`);
      resolve(code === 0 ? { ok: true } : { ok: false, error: `安装失败（退出码 ${code}）` });
    });
    child.on("error", (err) => {
      logger.error(`[install] ${inst.name} spawn error: ${String(err)}`);
      resolve({ ok: false, error: String(err) });
    });
  });
}
