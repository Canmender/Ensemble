#!/usr/bin/env node
/**
 * 版本号统一 bump：desktop 根 + packages/desktop 两处 package.json（web/server/shared
 * 版本独立演进不跟随）。用法：node scripts/bump-version.mjs 0.8.31
 * 背景：v0.8.17~0.8.29 手工 sed 只改了 packages/desktop，根包停在 0.8.16 漂移了两周。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("用法: node scripts/bump-version.mjs <x.y.z>");
  process.exit(1);
}

const files = [
  join(root, "package.json"),
  join(root, "packages/desktop/package.json"),
];
for (const f of files) {
  const pkg = JSON.parse(readFileSync(f, "utf8"));
  const old = pkg.version;
  pkg.version = version;
  writeFileSync(f, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`${old} -> ${version}  ${f.replace(root, ".")}`);
}
