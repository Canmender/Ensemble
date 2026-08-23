/**
 * 类型化事件总线（R3，载体 = 自研内核 waterfall）。
 *
 * 三个语义事件（实施手册 R3 任务书）：
 * - chat/message：engine 落库后 emit；hub 监听并广播（WS 帧字节级不变）
 * - device/status：设备上下线；context.ts 挂监听写设备表
 * - tool/confirm：HITL 确认瀑布——异步短路语义，返回 {approved} 即决策（含拒绝），
 *   undefined 交给下游；无人应答超时默认拒绝。决策必须包对象（bail 语义里 false 不算短路值）。
 *
 * 插件权限面（D，为 R4 per-user 铺路）：插件监听仅限白名单前缀；
 * 插件 emit 必须带自己插件 id 前缀（命名空间强制）。
 */
import type { MessageAttachment } from "@ensemble/shared";

// ---------- 载荷类型（进 shared 由三端消费）----------

export interface ChatMessagePayload {
  runId: string;
  jobId?: string;
  agentId: string;
  role: "user" | "assistant";
  content: string;
  attachment?: MessageAttachment;
  /** 服务端消息 ID（幂等键） */
  id: string;
  /** 会话内单调序号 */
  seq: number;
  userId?: string;
}

export interface DeviceInfo {
  userId: string;
  device: { id: string; name: string; type: string };
  online: boolean;
}

export interface ToolConfirmRequestPayload {
  runId: string;
  tool: string;
  args: unknown;
}

/** 插件可监听的事件白名单前缀 */
export const PLUGIN_LISTENABLE_PREFIXES = ["chat/", "run/", "device/"] as const;

/** 事件名合法性：插件监听须命中白名单前缀 */
export function isPluginListenable(event: string): boolean {
  return PLUGIN_LISTENABLE_PREFIXES.some((p) => event.startsWith(p));
}

/** 插件自有事件命名空间：emit 必须是 `<pluginId>/...` 形态 */
export function isPluginNamespaced(pluginId: string, event: string): boolean {
  return event.startsWith(`${pluginId}/`);
}

// ---------- 事件总线 ----------

export interface EventSink {
  emit(event: string, payload: unknown): void;
}

/**
 * 语义事件总线：内核 waterfall 之上的类型化封装。
 * - emit：fire-and-forget 分发（chat/message → hub 广播等观察者）
 * - requestToolConfirm：tool/confirm 异步短路瀑布；无监听器走 fallback（WS 弹窗）
 */
export class EventBus implements EventSink {
  constructor(private host: import("./kernel").PluginHost) {}

  /** 发射语义事件：观察者按注册序全部收到（异步分发，fire-and-forget） */
  emit(event: string, payload: unknown): void {
    void this.host.waterfallAsync(event, payload, () => undefined);
  }

  /**
   * HITL 工具确认瀑布：监听器返回 {approved} 即短路决策（含拒绝，false 也算——
   * 因为包在对象里）；全部未处理（undefined）→ fallback（hub.requestConfirm 等用户）。
   * 决策对象在此解包为布尔。
   */
  async requestToolConfirm(payload: ToolConfirmRequestPayload, fallback: () => Promise<boolean>): Promise<boolean> {
    const decision = await this.host.waterfallAsync<ToolConfirmRequestPayload, { approved: boolean } | undefined>(
      "tool/confirm",
      payload,
      () => undefined,
    );
    return decision ? decision.approved : fallback();
  }
}
