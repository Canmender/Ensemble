// 桌面端运行模式：本地模式 / 多端协作
// "local"  本地模式 — 单机不入网，无需登录，不连中继
// "multi"  多端协作 — 登录云端 + 连接中继，手机可经中继遥控本机
// null     尚未选择（首启引导页）
export type RunMode = "local" | "multi";

const MODE_KEY = "ensemble.mode";

export function getMode(): RunMode | null {
  const raw = localStorage.getItem(MODE_KEY);
  if (raw === "local" || raw === "multi") return raw;
  return null;
}

export function setMode(mode: RunMode): void {
  localStorage.setItem(MODE_KEY, mode);
}

export function clearMode(): void {
  localStorage.removeItem(MODE_KEY);
}
