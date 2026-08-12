import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// CJS bundle（esbuild）下 import.meta 不可用，回退 process.cwd()（仅影响 .env 查找，无害）
let serverRoot: string;
try {
  serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
} catch {
  serverRoot = resolve(process.cwd());
}
const repoRoot = resolve(serverRoot, "..", "..");

/** 尝试加载根目录 .env（不存在则静默忽略） */
export function loadDotEnv(): void {
  const envFile = resolve(repoRoot, ".env");
  if (!existsSync(envFile)) return;
  let content: string;
  try {
    content = readFileSync(envFile, "utf8");
  } catch {
    return;
  }
  for (const line of content.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    if (!(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

export interface ServerEnv {
  port: number;
  dbPath: string;
  configDir: string;
  hermesExecutable?: string;
  hermesUseWsl: boolean;
  hermesWslDistro: string;
  /**
   * 固定 API key（headless/Docker 部署用）。配置后：
   * - 替代自动生成的随机 session token，作为 HTTP 与 WS 的访问凭证
   * - /api/ws-token 端点被禁用（公网绑定 0.0.0.0 时防止 token 被任意获取）
   */
  apiKey?: string;
  /**
   * 监听地址（桌面版默认 127.0.0.1）。设为 0.0.0.0 允许局域网访问，
   * 用于移动端直连；此时建议配合 ENSEMBLE_API_KEY 或至少设置防火墙。
   */
  lanHost?: string;
  /** 启动时自动接入本机已安装的 agent harness（默认开；设为 false 关闭） */
  autoSyncLocal?: boolean;
  /** 托管前端静态资源目录（headless/Docker 部署时提供 web 界面） */
  staticDir?: string;
  /** 中继服务器地址（自用：桌面端默认连接云端中继，移动端经此 IM/遥控） */
  relayUrl?: string;
  /** 中继服务器鉴权密钥（RELAY_AUTH_KEY） */
  relayKey?: string;
}

export function getEnv(): ServerEnv {
  loadDotEnv();
  return {
    port: Number(process.env.PORT ?? 8787),
    dbPath: resolve(serverRoot, process.env.DB_PATH ?? "data/ensemble.db"),
    configDir: resolve(repoRoot, process.env.CONFIG_DIR ?? "config"),
    hermesExecutable: process.env.HERMES_EXECUTABLE || undefined,
    hermesUseWsl: process.env.HERMES_USE_WSL === "true",
    hermesWslDistro: process.env.HERMES_WSL_DISTRO ?? "Ubuntu",
    apiKey: process.env.ENSEMBLE_API_KEY || undefined,
    lanHost: process.env.ENSEMBLE_LAN_HOST || undefined,
    autoSyncLocal: process.env.ENSEMBLE_AUTO_SYNC_LOCAL !== "false",
    staticDir: process.env.ENSEMBLE_STATIC_DIR || undefined,
    // 自用默认连接云端中继（服务器只作中介，桌面端为主办公、移动端 IM/遥控）
    relayUrl: process.env.RELAY_URL || "http://SERVER_IP_REDACTED:8888",
    relayKey: process.env.RELAY_AUTH_KEY || "RELAY_AUTH_KEY_REDACTED",
  };
}
