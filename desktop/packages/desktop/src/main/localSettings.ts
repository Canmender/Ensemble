import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 本机 settings.json 里的用户可编辑字段（主进程侧只读视图） */
export interface LocalSettings {
  /** 云端服务器地址 host[:port]（多端协作/自动更新用） */
  cloudHost?: string;
}

/** 读取 userData/config/settings.json（不存在或损坏返回空对象） */
export function readLocalSettings(): LocalSettings {
  try {
    // 延迟 import electron：本模块被 main 与工具脚本共同引用时避免硬依赖
    const { app } = require("electron") as typeof import("electron");
    const file = join(app.getPath("userData"), "config", "settings.json");
    if (!existsSync(file)) return {};
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return typeof raw === "object" && raw ? (raw as LocalSettings) : {};
  } catch {
    return {};
  }
}

/** 规范化的云端基址（无配置返回 null）：补协议、去尾斜杠 */
export function cloudBaseUrl(): string | null {
  const host = readLocalSettings().cloudHost?.trim().replace(/\/+$/, "");
  if (!host) return null;
  return /^https?:\/\//i.test(host) ? host : `http://${host}`;
}
