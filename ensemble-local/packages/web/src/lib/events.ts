// 事件相关的纯函数（可测试）

export interface AgentEventLike {
  type: string;
  ts?: number;
  text?: string;
  [k: string]: unknown;
}

/** 把 output 事件按时间序拼接成文本 */
export function accumulateText(events: AgentEventLike[]): string {
  return events
    .filter((e) => e.type === "output")
    .map((e) => (typeof e.text === "string" ? e.text : ""))
    .join("");
}

/** 时间戳 → 短时间 HH:MM:SS */
export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 10) return "刚刚";
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}
