// 强制模式：决定前端跳过首启模式选择页、锁定运行模式。
// 优先级：Electron 运行时版本（window.desktop.edition，本地版→local / 云端版→multi）
//        > 构建期 VITE_FORCE_MODE（变体启动脚本/浏览器开发注入）。
// 两者都没有时返回 null，由用户在 ModeLandingPage 自行选择。

export type ForcedMode = "local" | "multi";

const runtimeEdition = ((window as any)?.desktop?.edition as string | undefined)?.trim().toLowerCase();
const runtimeForced: ForcedMode | null =
  runtimeEdition === "local" ? "local" : runtimeEdition === "cloud" ? "multi" : null;

const buildForced: ForcedMode | null = (() => {
  const v = ((import.meta as any).env?.VITE_FORCE_MODE as string | undefined)?.trim().toLowerCase();
  return v === "local" || v === "multi" ? v : null;
})();

const FORCED: ForcedMode | null = runtimeForced ?? buildForced;

export function getForcedMode(): ForcedMode | null {
  return FORCED;
}

export function isForcedMode(): boolean {
  return FORCED !== null;
}
