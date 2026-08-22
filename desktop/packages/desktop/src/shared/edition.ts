/**
 * 版本定义（纯逻辑，无 Electron 依赖）：main 与 preload 共用。
 * - local：本地版 —— 完全离线，数据在本机，无需登录
 * - cloud：云端版 —— 连接自用云端服务器（多端协作），需登录
 */

export type Edition = "local" | "cloud";

export const EDITION_LABEL: Record<Edition, string> = {
  local: "本地版",
  cloud: "云端版",
};

/** 解析 --ensemble-edition=local|cloud 命令行参数（main argv 与 renderer additionalArguments 共用） */
export function parseEditionArg(argv: readonly string[]): Edition | null {
  const prefix = "--ensemble-edition=";
  const raw = argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
  return parseEditionValue(raw);
}

/** 解析版本值（环境变量 / marker 文件内容等自由字符串） */
export function parseEditionValue(raw: string | undefined): Edition | null {
  const v = raw?.trim().toLowerCase();
  return v === "local" || v === "cloud" ? v : null;
}
