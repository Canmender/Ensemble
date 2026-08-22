import { app } from "electron";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEditionArg, parseEditionValue, type Edition } from "../shared/edition";

export { EDITION_LABEL } from "../shared/edition";
export type { Edition } from "../shared/edition";
export { parseEditionArg } from "../shared/edition";

const MARKER_FILE = "edition.txt";

/** marker 与 editions/ 都放在默认 userData 根（分区前的那一层） */
function markerPath(): string {
  return join(app.getPath("userData"), MARKER_FILE);
}

function readMarker(): Edition | null {
  try {
    return parseEditionValue(readFileSync(markerPath(), "utf8"));
  } catch {
    return null;
  }
}

/**
 * 解析本次运行的版本：--ensemble-edition= → ENSEMBLE_EDITION → 安装包内置版本
 * （打包时写入 resources/edition.txt，区分本地版/云端版安装包）→ 上次选择 → 默认 local。
 * 必须在 app.ready 与单实例锁之前调用；解析后把本次选择写回 marker（无参启动时沿用）。
 */
export function resolveEdition(): Edition {
  const edition =
    parseEditionArg(process.argv) ??
    parseEditionValue(process.env.ENSEMBLE_EDITION) ??
    readResourcesEdition() ??
    readMarker() ??
    "local";
  try {
    writeFileSync(markerPath(), edition, "utf8");
  } catch {
    /* marker 写失败不阻断启动 */
  }
  return edition;
}

/** 打包安装包内置的固定版本标识（resources/edition.txt，由 electron-builder extraResources 注入） */
function readResourcesEdition(): Edition | null {
  try {
    if (!app.isPackaged) return null;
    return parseEditionValue(readFileSync(join(process.resourcesPath, "edition.txt"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * userData 按版本分区：<默认 userData>/editions/<edition>。
 * 数据库 / config / secrets.json 与 Chromium 存储（localStorage、IndexedDB 等）
 * 全部随版本隔离——本地版与云端版互不可见、互不污染。
 * 必须在单实例锁之前调用：锁随 userData 作用域，两个版本因此可同时运行。
 */
export function applyEditionWorkspace(edition: Edition): void {
  const parent = app.getPath("userData"); // setPath 之前调用 = 默认根
  const target = join(parent, "editions", edition);
  mkdirSync(target, { recursive: true });
  if (edition === "local") migrateLegacyWorkspace(parent, target);
  app.setPath("userData", target);
}

/**
 * 一次性迁移：分区机制引入前，本地版工作区直接写在默认 userData 根下
 * （config/、data/、secrets.json）。首次以本地版分区启动时搬入新目录。
 * 云端版不迁移——其业务数据在云端服务器，本地仅是缓存。
 */
function migrateLegacyWorkspace(parent: string, target: string): void {
  const legacyDb = join(parent, "data", "ensemble.db");
  const newDb = join(target, "data", "ensemble.db");
  if (!existsSync(legacyDb) || existsSync(newDb)) return;
  console.warn(`[edition] 迁移历史本地版工作区 → ${target}`);
  for (const name of ["config", "data", "secrets.json"]) {
    const src = join(parent, name);
    const dst = join(target, name);
    if (!existsSync(src) || existsSync(dst)) continue;
    try {
      cpSync(src, dst, { recursive: true });
    } catch (e) {
      console.warn(`[edition] 迁移失败: ${name}`, e);
    }
  }
}
