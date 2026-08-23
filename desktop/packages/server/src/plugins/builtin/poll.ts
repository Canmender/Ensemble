/**
 * 群投票插件（U1-B，官方第二个插件——卡片协议的端到端验证载体）。
 *
 * 能力面：
 * - 发起投票 → 向会话发 cardType:"poll" 结构化卡片消息（经 events 总线）
 * - POST /vote 动作（经 per-user 插件动作路由）→ 更新票数 → 广播新版本卡片
 *
 * state 存 PluginUserKv（重启不丢）；卡片 state 形状见 shared PollCardState。
 */
import type { CandidatePlugin } from "../per-user";
import type { PluginContext } from "../kernel";
import type { EventSink } from "../events";
import { newId } from "../../util/id";

interface PollConfig {
  /** 每人可改票次数上限（0 = 不可改票） */
  maxRevote?: number;
}

interface PollState {
  question: string;
  options: Array<{ id: string; label: string }>;
  votes: Record<string, number>;
  closed?: boolean;
}

interface PollMeta {
  runId: string;
  createdBy: string;
  createdAt: number;
}

export const pollPlugin: CandidatePlugin = {
  manifest: {
    id: "poll",
    name: "群投票",
    version: "0.1.0",
    description: "在会话里发起投票，成员点击选项即时计票",
    scheduled: 0,
    eventsOn: [],
  },
  create: (runtime) => ({
    install: (ctx) => {
      // 动作处理（per-user 注册）：
      // POST /actions/create  body: { runId, question, options: string[] } → 发起投票
      // POST /actions/vote    body: { pollId, optionId }            → 计票并广播新卡片
      ctx.effect(() => {
        const unregisterAction = registerPollActions(runtime, ctx, {
          create: (body) => handleCreate(runtime, ctx, body as { runId?: string; question?: string; options?: string[] }),
          vote: (body) => handleVote(runtime, ctx, body as { pollId?: string; optionId?: string }),
        });
        return unregisterAction;
      }, "poll-actions");
    },
  }),
};

// ---------- 动作注册（经 ctx.provide 挂到宿主级 action 表）----------

type PollActionHandler = (body: unknown) => Promise<unknown> | unknown;
type ActionTable = Map<string, PollActionHandler>;

function registerPollActions(
  runtime: import("../per-user").UserPluginRuntime,
  ctx: PluginContext,
  handlers: Record<string, PollActionHandler>,
): () => void {
  // 宿主级动作表：键 `user/<uid>/<pluginId>/<action>`（per-user 维度——不同用户的
  // 同名插件实例各自注册自己的闭包，互不覆盖）。动作端点按登录用户拼键查此表。
  let table = ctx.tryGet<ActionTable>("plugin-actions");
  if (!table) {
    table = new Map();
    ctx.provide("plugin-actions", table);
  }
  for (const [action, handler] of Object.entries(handlers)) {
    table.set(`user/${runtime.userId}/${runtime.manifest.id}/${action}`, handler);
  }
  return () => {
    for (const action of Object.keys(handlers)) {
      table!.delete(`user/${runtime.userId}/${runtime.manifest.id}/${action}`);
    }
  };
}

async function handleCreate(
  runtime: import("../per-user").UserPluginRuntime,
  ctx: PluginContext,
  body: { runId?: string; question?: string; options?: string[] },
) {
  const { runId, question } = body;
  const labels = (body.options ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (!runId || !question?.trim() || labels.length < 2 || labels.length > 10) {
    return { error: "需要 runId、question 和 2-10 个选项" };
  }
  const pollId = newId("poll");
  const options = labels.map((label, i) => ({ id: `opt-${i + 1}`, label }));
  const state: PollState = { question: question.trim(), options, votes: {} };
  runtime.kv.set(`poll:${pollId}:state`, state);
  runtime.kv.set(`poll:${pollId}:meta`, {
    runId,
    createdBy: runtime.userId,
    createdAt: Date.now(),
  });

  // 发卡片消息
  const sink = ctx.tryGet<EventSink>("events");
  sink?.emit("chat/message", {
    runId,
    jobId: undefined,
    agentId: "poll",
    role: "assistant" as const,
    content: `📊 投票发起：${question.trim()}`,
    attachment: {
      type: "plugin-card",
      name: `${question.trim()}.poll`,
      size: JSON.stringify(state).length,
      url: "",
      card: buildCard(pollId, state, 0),
    },
    id: newId("msg"),
    seq: -1,
    userId: runtime.userId,
  });
  return { ok: true, pollId };
}

async function handleVote(runtime: import("../per-user").UserPluginRuntime, ctx: PluginContext, body: { pollId?: string; optionId?: string }) {
  const cfg = (runtime.config ?? {}) as PollConfig;
  const { pollId, optionId } = body;
  if (!pollId || !optionId) return { error: "pollId/optionId 必填" };

  const meta = runtime.kv.get<PollMeta>(`poll:${pollId}:meta`);
  const state = runtime.kv.get<PollState>(`poll:${pollId}:state`);
  if (!meta || !state) return { error: "投票不存在" };
  if (state.closed) return { error: "投票已结束" };
  if (!state.options.some((o) => o.id === optionId)) return { error: "无效选项" };

  // 记票（v1 单选；改票=迁移旧票）
  const myKey = `poll:${pollId}:user`;
  const prev = runtime.kv.get<string | undefined>(myKey);
  if (prev && !(cfg.maxRevote ?? 1)) return { error: "该投票不允许改票" };
  if (prev) state.votes[prev] = Math.max(0, (state.votes[prev] ?? 1) - 1);
  state.votes[optionId] = (state.votes[optionId] ?? 0) + 1;
  runtime.kv.set(myKey, optionId);
  runtime.kv.set(`poll:${pollId}:state`, state);

  // 广播新版本卡片（新消息追加）
  const sink = ctx.tryGet<EventSink>("events");
  const totalVotes = Object.values(state.votes).reduce((a, b) => a + b, 0);
  sink?.emit("chat/message", {
    runId: meta.runId,
    jobId: undefined,
    agentId: "poll",
    role: "assistant" as const,
    content: `📊 ${state.question}（当前 ${totalVotes} 票）`,
    attachment: {
      type: "plugin-card",
      name: `${state.question}.poll`,
      size: JSON.stringify(state).length,
      url: "",
      card: buildCard(pollId, state, totalVotes),
    },
    id: newId("msg"),
    seq: -1,
    userId: runtime.userId,
  });
  return { ok: true, totalVotes };
}

/** 构造 poll 卡片载荷（shared PollCardState 形状） */
export function buildCard(pollId: string, state: PollState, totalVotes: number) {
  return {
    cardType: "poll" as const,
    cardVersion: 1 as const,
    title: state.question,
    state: {
      pollId,
      question: state.question,
      options: state.options,
      votes: state.votes,
      totalVotes,
      closed: !!state.closed,
    },
    actions: state.closed
      ? []
      : state.options.map((o) => ({
          id: `vote-${o.id}`,
          label: o.label,
          style: "primary" as const,
          // 相对插件 actions 根（勿带 /actions 前缀——路由端已含 /actions/:action 段）
          endpoint: "/vote",
          payload: { pollId, optionId: o.id },
        })),
  };
}
