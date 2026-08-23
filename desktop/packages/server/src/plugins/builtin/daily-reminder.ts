/**
 * 每日提醒插件（R4 官方示范，SDK 文档第一章素材）。
 *
 * manifest 声明 scheduled:1 + settings（提醒时间 HH:mm / 提醒文案）；
 * 到点向用户绑定的会话发消息——经 EventBus.emit("chat/message") 而非直调 hub
 * （示范"插件消费宿主能力"的正道：与 hub 广播、未来卡片渲染同一条链路）。
 *
 * 配置（user_plugins.config_json）：
 * { "time": "09:00", "message": "该做每日站会记录了", "conversationRunId": "run-xxx" }
 */
import type { CandidatePlugin } from "../per-user";
import type { PluginContext } from "../kernel";
import type { EventSink } from "../events";

interface ReminderConfig {
  /** 24h 制 HH:mm */
  time?: string;
  message?: string;
  /** 目标会话的 runId（设置页选择或从聊天页复制） */
  conversationRunId?: string;
}

export const dailyReminderPlugin: CandidatePlugin = {
  manifest: {
    id: "daily-reminder",
    name: "每日提醒",
    version: "0.1.0",
    description: "每天定时向指定会话发送一条提醒消息",
    scheduled: 1,
    eventsOn: [],
    settings: [
      { key: "time", label: "提醒时间", placeholder: "09:00" },
      { key: "message", label: "提醒文案", placeholder: "该做每日站会记录了" },
      { key: "conversationRunId", label: "目标会话 runId", placeholder: "run-xxx（从聊天页复制）" },
    ],
  },
  create: (runtime) => ({
    install: (ctx) => {
      const cfg = (runtime.config ?? {}) as ReminderConfig;
      const time = /^\d{2}:\d{2}$/.test(cfg.time ?? "") ? cfg.time! : "09:00";
      const message = cfg.message?.trim() || "每日提醒";
      const runId = cfg.conversationRunId?.trim();

      // 落库持久状态：下次触发时间（重启不丢、不重复发）
      const state = runtime.kv.get<{ nextAt?: number }>("state") ?? {};
      const now = Date.now();
      if (!state.nextAt || state.nextAt <= now) {
        state.nextAt = nextOccurrence(time, now);
        runtime.kv.set("state", state);
      }

      // 秒级检查循环（effect 化：unregister 自动清理）；发消息用 install 注入的 ctx
      ctx.effect(() => {
        const timer = setInterval(() => {
          const s = runtime.kv.get<{ nextAt?: number }>("state") ?? {};
          if (!s.nextAt || Date.now() < s.nextAt) return;
          fire(runtime, ctx, runId, message);
          s.nextAt = nextOccurrence(time, Date.now());
          runtime.kv.set("state", s);
        }, 30_000);
        timer.unref?.();
        return () => clearInterval(timer);
      }, "reminder-timer");
    },
  }),
};

/** 下一个 HH:mm 触发时刻（已过今天时点则排明天） */
function nextOccurrence(hhmm: string, from: number): number {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(from);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= from) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** 发提醒消息：走事件总线（chat/message），由 chat-broadcaster 广播落链路 */
function fire(runtime: import("../per-user").UserPluginRuntime, ctx: PluginContext, runId: string | undefined, message: string): void {
  if (!runId) return;
  const sink = ctx.tryGet<EventSink>("events");
  if (!sink) return; // 事件总线不可用（异常环境）→ 静默跳过本轮
  sink.emit("chat/message", {
    runId,
    jobId: undefined,
    agentId: "daily-reminder",
    role: "assistant",
    content: `⏰ ${message}`,
    id: `remind-${Date.now()}`,
    seq: -1, // 由消息链路分配；此处仅广播展示
    userId: runtime.userId,
  });
}
