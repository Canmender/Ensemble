/**
 * 插件卡片协议（U1，v1 定稿 2026-08-23）——双端契约，改动需三端同步评审。
 *
 * 设计要点：
 * - 卡片以内联 PluginCardPayload 随消息传输（MessageAttachment.card 字段）：
 *   卡片 state 通常 <10KB（消息体上限 150MB），内联省引用解析且历史消息天然带全量 state。
 * - **原位更新 = 新消息追加**：聊天流不可变心智；服务端 seq 幂等链路现成，
 *   客户端按 attachment.card.state 替换渲染，不回写旧消息。
 * - **未识别 cardType 的客户端行为（兼容性契约）**：渲染通用折叠框显示 title +
 *   原始 JSON，永不白屏。模板只加不改；cardVersion 升级时旧客户端走此降级路径。
 * - actions 永远经受控 API：点击 = 带 token POST 到插件路由 → 响应返回新 state →
 *   本地原位刷新。UI 只是数据的镜子，片段拿不到 token/原生 API。
 */

/** 卡片动作按钮：点击 = POST {endpoint}（相对 /api/users/me/plugins/<pluginId> 根） */
export interface CardAction {
  id: string;
  label: string;
  style?: "primary" | "normal" | "danger";
  /** 相对插件根路径，如 "/vote"；服务端拼全路径并校验归属插件 */
  endpoint: string;
  payload?: Record<string, unknown>;
}

/**
 * 结构化插件卡片的完整载荷（随 MessageAttachment.card 内联）。
 * state 形状由 cardType 对应的模板约定（见各模板组件 props）。
 */
export interface PluginCardPayload {
  /** 模板类型：内置五类 + 插件自定义（未识别走折叠框降级） */
  cardType: "poll" | "form" | "list" | "stats" | "progress" | "rich" | (string & {});
  cardVersion: 1;
  title?: string;
  state: Record<string, unknown>;
  actions: CardAction[];
}

// ---------- poll 模板的 state 约定 ----------

export interface PollCardState {
  question: string;
  options: Array<{ id: string; label: string }>;
  /** optionId → 票数 */
  votes: Record<string, number>;
  /** 我投过的选项 id（多选场景为数组；单选为单个）——服务端按用户注入 */
  myVotes?: string[];
  totalVotes: number;
  closed?: boolean;
}

/** 类型守卫：消息附件是否携带合法的 v1 插件卡片 */
export function isPluginCard(att: unknown): att is { type: "plugin-card"; name: string; size: number; url: string; card: PluginCardPayload } {
  if (typeof att !== "object" || att === null) return false;
  const a = att as Record<string, unknown>;
  return (
    a.type === "plugin-card" &&
    typeof a.card === "object" && a.card !== null &&
    (a.card as PluginCardPayload).cardVersion === 1 &&
    Array.isArray((a.card as PluginCardPayload).actions)
  );
}
