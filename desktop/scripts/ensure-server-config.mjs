/**
 * 打包前置：确保 server.config.js 存在于 packages/desktop/（electron-builder
 * extraResources 打进安装包 resources/，主进程启动时读取 cloud.host 作为默认地址）。
 *
 * 隐私铁律下的"两份式"：真实地址不进 git——本脚本在打包机本地生成该文件：
 * - 已存在（开发者手工维护）→ 原样保留
 * - 不存在 → 从构建机的 gitignored .env 读 CLOUD_HOST 生成；读不到则报错退出
 *   （宁可构建失败不可打出无地址的坏包——用户首启就得手填服务器）
 *
 * 仅云端版打包流程调用（package:cloud）；本地版保持纯离线不打此文件。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(desktopRoot, "packages/desktop");
const target = join(pkgDir, "server.config.js");

if (existsSync(target)) {
  console.log("✓ server.config.js 已存在（保留现有配置）");
} else {
  // CLOUD_HOST 来源优先级：环境变量 → 本检出向上找 .env → 主检出 D:/MultiAgent/.env
  let host = process.env.CLOUD_HOST?.trim() ?? "";
  if (!host) {
    const candidates = [
      join(desktopRoot, "../.env"),
      join(desktopRoot, "../../.env"),
      "D:/MultiAgent/.env", // 主检出（worktree 场景 gitignored .env 只在那里）
    ];
    for (const p of candidates) {
      if (!existsSync(p)) continue;
      const m = readFileSync(p, "utf8").match(/^CLOUD_HOST=(.+)$/m);
      if (m?.[1]?.trim()) {
        host = m[1].trim();
        break;
      }
    }
  }
  if (!host) {
    console.error(
      "✗ 缺少 server.config.js 且无法从 .env 解析 CLOUD_HOST。\n" +
        "  请创建 desktop/packages/desktop/server.config.js（参考 server.config.example.js），\n" +
        "  或在仓库根 .env 配置 CLOUD_HOST=<服务器IP>。",
    );
    process.exit(1);
  }
  writeFileSync(
    target,
    `// 由 scripts/ensure-server-config.mjs 在打包时生成（gitignored，不入库）\n` +
      `module.exports = {\n  cloud: { host: "${host}", port: 8787 },\n};\n`,
  );
  console.log(`✓ server.config.js 已生成（cloud.host=${host}）`);
}
