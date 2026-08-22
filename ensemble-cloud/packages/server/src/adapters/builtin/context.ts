import type { LLMMessage } from "../../llm/types";

/** 粗略 token 估算：CJK ≈ 1 token/字，ASCII ≈ 1 token/4 字符 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let ascii = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) > 0x2e80) cjk++;
    else ascii++;
  }
  return cjk + Math.ceil(ascii / 4);
}

/** 上下文窗口裁剪：保留 system 消息与最近消息，从最旧的非 system 丢弃 */
export function truncateToTokens(msgs: LLMMessage[], budgetTokens: number): LLMMessage[] {
  let total = msgs.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  if (total <= budgetTokens) return msgs;

  const result = [...msgs];
  while (total > budgetTokens && result.length > 1) {
    const idx = result.findIndex((m) => m.role !== "system");
    if (idx === -1) break;
    total -= estimateTokens(result[idx].content);
    result.splice(idx, 1);
  }
  return result;
}
