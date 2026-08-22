// 构建期强制模式：版本启动脚本注入 VITE_FORCE_MODE 跳过首启选择页。
// ensemble-local/start.bat → local，ensemble-cloud/start.bat → multi；
// 未注入（pnpm dev:web 独立开发）返回 null，由用户在 ModeLandingPage 自行选择。

export type ForcedMode = "local" | "multi";

const FORCED = ((import.meta as any).env?.VITE_FORCE_MODE as string | undefined)?.trim().toLowerCase();

export function getForcedMode(): ForcedMode | null {
  return FORCED === "local" || FORCED === "multi" ? FORCED : null;
}

export function isForcedMode(): boolean {
  return getForcedMode() !== null;
}
