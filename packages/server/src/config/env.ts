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
}

export function getEnv(): ServerEnv {
  loadDotEnv();
  return {
    port: Number(process.env.PORT ?? 8787),
    dbPath: resolve(serverRoot, process.env.DB_PATH ?? "data/multiagent.db"),
    configDir: resolve(repoRoot, process.env.CONFIG_DIR ?? "config"),
    hermesExecutable: process.env.HERMES_EXECUTABLE || undefined,
    hermesUseWsl: process.env.HERMES_USE_WSL === "true",
    hermesWslDistro: process.env.HERMES_WSL_DISTRO ?? "Ubuntu",
  };
}
