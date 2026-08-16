// 桌面端运行模式：本地模式 / 多端协作
// "local"  本地模式 — 单机不入网，无需登录，不连中继
// "multi"  多端协作 — 登录云端 + 连接中继，手机可经中继遥控本机
// null     尚未选择（首启引导页）
import { useSyncExternalStore } from "react";

export type RunMode = "local" | "multi";

const MODE_KEY = "ensemble.mode";
let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version += 1;
  for (const cb of listeners) cb();
}

function readMode(): RunMode | null {
  const raw = localStorage.getItem(MODE_KEY);
  if (raw === "local" || raw === "multi") return raw;
  return null;
}

export function getMode(): RunMode | null {
  return readMode();
}

export function setMode(mode: RunMode): void {
  localStorage.setItem(MODE_KEY, mode);
  notify();
}

export function clearMode(): void {
  localStorage.removeItem(MODE_KEY);
  notify();
}

/** 响应式读取当前模式（模式切换时组件会重渲染） */
export function useMode(): RunMode | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readMode,
  );
}
