import type { Run, Task } from "@multiagent/shared";
import { OrchestrationEngine } from "./engine";
import { logger } from "../util/logger";

const DONE_RE = /@done\b|\[DONE\]/i;
const DELEGATE_RE = /@([a-zA-Z0-9-]+)\s*[:：]\s*([\s\S]+)/;

/**
 * Mode 3 — 对话式群聊：
 * - round-robin 轮转，每轮每个参与者收到完整 transcript 作为 context
 * - resumeSessionId 让同一 agent 跨轮保留上下文
 * - @agent: 任务 委派解析；@done / [DONE] 终止
 */
export class ChatMode {
  constructor(private engine: OrchestrationEngine) {}

  async run(run: Run, task: Task): Promise<string> {
    if (task.input.mode !== "chat") throw new Error("task is not chat mode");
    const { prompt, participantIds, maxRounds } = task.input;
    const participants = participantIds;
    const rounds = maxRounds;

    this.engine.broadcastChatMessage(run.id, undefined, "user", "user", prompt);
    const transcript: Array<{ agentId: string; role: "user" | "assistant"; content: string }> = [
      { agentId: "user", role: "user", content: prompt },
    ];

    let stopped = false;
    let round = 0;

    while (!stopped && round < rounds) {
      logger.info(`chat round ${round + 1}/${rounds}`);

      for (const agentId of participants) {
        const transcriptText = transcript
          .map((m) => `${m.role === "user" ? "User" : `@${m.agentId}`}: ${m.content}`)
          .join("\n\n");

        const resumeSessionId = this.engine.getLatestSessionId(run.id, agentId);
        const job = await this.engine.executeJob(
          run,
          agentId,
          `Continue the collaborative discussion. Your role: ${agentId}. ` +
            `Reply concisely. If the task is finished, end with [DONE]. ` +
            `To delegate work to a colleague, write "@agent:<task>" where agent is one of: ${participants.join(", ")}.`,
          { context: transcriptText, resumeSessionId },
        );

        const content = job.result?.trim() ?? "";
        if (content) {
          this.engine.broadcastChatMessage(run.id, job.id, agentId, "assistant", content);
          transcript.push({ agentId, role: "assistant", content });
        }

        // 委派解析：@agent:任务 → 派发一个子 job，结果回填
        const delegate = DELEGATE_RE.exec(content);
        if (delegate && participants.includes(delegate[1])) {
          const target = delegate[1];
          const subPrompt = delegate[2].trim();
          const subJob = await this.engine.executeJob(
            run,
            target,
            subPrompt,
            { resumeSessionId: this.engine.getLatestSessionId(run.id, target) },
            job.id,
          );
          const subContent = subJob.result?.trim() ?? "";
          if (subContent) {
            this.engine.broadcastChatMessage(run.id, subJob.id, target, "assistant", subContent);
            transcript.push({ agentId: target, role: "assistant", content: subContent });
          }
        }

        if (DONE_RE.test(content)) {
          stopped = true;
          break;
        }
      }
      round++;
    }

    // 汇总：最后一条 assistant 消息，或完整 transcript
    const last = [...transcript].reverse().find((m) => m.role === "assistant");
    if (last) return last.content;
    return transcript.map((m) => `${m.agentId}: ${m.content}`).join("\n\n");
  }
}
