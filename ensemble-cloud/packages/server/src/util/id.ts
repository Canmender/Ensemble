import { randomBytes } from "node:crypto";

/** 生成短随机 ID（nanoid 风格，避免额外依赖） */
export function newId(prefix = ""): string {
  const raw = randomBytes(6).toString("base64url");
  return prefix ? `${prefix}_${raw}` : raw;
}
