import type { LLMProvider } from "../llm/types";
import { estimateTokens } from "../adapters/builtin/context";

/** 记忆 LLM 调用（flush / consolidate），复用 provider.chat */
export class MemoryLlm {
  constructor(private deps: { provider: LLMProvider; model: string }) {}

  /** flush：对话窗口 → daily log 要点块 */
  async flush(transcript: string, prompt: string, now: Date): Promise<string> {
    const dateStr = now.toISOString().slice(0, 16).replace("T", " ");
    const sys = `你是记忆提取器。从对话中提取值得长期记住的事实，输出 markdown 要点（≤30 行，去掉寒暄）：
- 用户偏好
- 决策与结论
- 关键事实（含路径/命令/参数）
- 已创建/修改的文件
只输出要点，不要其他内容。`;

    const transcriptClipped = clipTranscript(transcript);
    const result = await this.deps.provider.chat({
      model: this.deps.model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `任务: ${prompt.slice(0, 500)}\n\n对话记录:\n${transcriptClipped}` },
      ],
      maxTokens: 700,
    });
    return `## ${dateStr} · task: ${prompt.slice(0, 80)}\n${result.text.trim()}\n`;
  }

  /** consolidate：daily logs + 旧 MEMORY.md → 新 MEMORY.md */
  async consolidate(agentId: string, oldMemory: string, dailyLogs: string, maxChars: number): Promise<string> {
    const sys = `你是长期记忆整理者。合并去重、丢弃过期信息、保留精确可复用的事实。
输出 markdown（≤${maxChars} 字符），结构：
# 长期记忆 — ${agentId}
## 用户偏好
## 常用命令/路径/工作区
## 进行中的项目与结论
## 已完成的产物
只输出整理后的记忆，不要其他内容。`;

    const logs = dailyLogs.slice(0, 40_000);
    const old = oldMemory.slice(0, 8_000);
    const result = await this.deps.provider.chat({
      model: this.deps.model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `## 最近的日常记录\n${logs}\n\n## 旧的长期记忆\n${old || "(无)"}` },
      ],
      maxTokens: 1200,
    });
    return result.text.trim().slice(0, maxChars);
  }
}

function clipTranscript(transcript: string): string {
  const budget = 8000;
  const tokens = estimateTokens(transcript);
  if (tokens <= budget) return transcript;
  // 粗略按字符比例裁剪（保留头部关键信息）
  const ratio = budget / tokens;
  const chars = Math.floor(transcript.length * ratio);
  return transcript.slice(0, chars) + "\n…[已截断]";
}
