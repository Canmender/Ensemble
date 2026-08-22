
// Vite 环境变量类型声明
declare global {
  interface ImportMeta {
    env: Record<string, string>;
  }
}
// 云端 API 基址解析（多端协作模式）
// 本地模式：base = ""（走本机服务器同源）
// 多端协作：base = "http://<cloudHost>"（走云端服务器，与手机同一账号/数据）
import { getMode } from "./mode";

let cloudHostCache: string | null = null;
let fetching: Promise<string> | null = null;

/** 读取云端主机（本地 settings.cloudHost，如 "your-server:8787"）。多端协作时使用。 */
async function loadCloudHost(): Promise<string> {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) return "";
    const json = (await res.json()) as { data?: { cloudHost?: string } };
    return json?.data?.cloudHost || "";
  } catch {
    return "";
  }
}

/**
 * 返回多端协作时应附加的云基址（含协议，去尾部 /）。本地/未配置时返回 ""。
 * 内部缓存 + 并发去重。
 * 
 * 开发模式下使用 Vite 代理避免 CORS 问题：
 * - 本地请求：直接走 /api
 * - 云端请求：走 /cloud-api（Vite 代理到云端服务器）
 */
export function getCloudBase(): Promise<string> {
  const isMulti = getMode() === "multi";
  if (!isMulti) return Promise.resolve("");
  if (cloudHostCache !== null) return Promise.resolve(cloudHostCache);
  if (fetching) return fetching;
  fetching = loadCloudHost()
    .then((host) => {
      if (!host) {
        cloudHostCache = "";
        return "";
      }
      // 开发模式下使用 Vite 代理避免 CORS
      const isDev = import.meta.env?.DEV;
      if (isDev) {
        // 使用 /cloud-api 代理（Vite 会转发到云端服务器）
        // 前端代码会拼接 base + "/api/auth/login"，所以这里返回 /cloud-api
        // 最终 URL: /cloud-api/api/auth/login -> 代理重写为 /api/auth/login
        cloudHostCache = "/cloud-api";
        return "/cloud-api";
      }
      // 生产模式直接连接
      const base = `http://${host.trim().replace(/\/+$/, "")}`;
      cloudHostCache = base;
      return base;
    })
    .finally(() => {
      fetching = null;
    });
  return fetching;
}

/** 强制刷新缓存（设置变更后调用） */
export function clearCloudBase(): void {
  cloudHostCache = null;
}

/** 判断当前是否为多端协作模式（供 UI 快速判断） */
export function isMultiMode(): boolean {
  return getMode() === "multi";
}