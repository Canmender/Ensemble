/**
 * 设备互联协议 v1（L1，方案《手机桌面互联方案》P0+P1）。
 *
 * DeviceLinkEnvelope：互联信令的版本化信封——relay 只做盲转发，双端按 kind 消费；
 * msgId 为幂等键（接收端去重，断线补拉不重复）；pairId 限定已配对设备对
 * （配对模型见 device-pair 相关 API）。
 *
 * 补拉同构 IM 主链路 afterSeq 的设计模式：sync.request(sinceTs) → sync.delta 回放。
 */
import type { DeviceType } from "./device-link";

/** 互联信令种类（v1 范围；扩展只加不改） */
export type DeviceLinkKind =
  | "sync.request"   // 补拉请求（payload: sinceTs）
  | "sync.delta"     // 补拉回放（payload: events[]，可能分片多帧）
  | "handoff"        // 会话接力（payload: { runId?, url?, draft? }）
  | "notify"         // 通知即指令（payload 自由；推送门铃醒来后走 sync.request）
  | "call.signal";   // 通话信令透传（复用现有 call 语义）

/** 互联信令信封（双端共同契约；relay 盲转发不解读） */
export interface DeviceLinkEnvelope<T = unknown> {
  /** 协议版本 */
  v: 1;
  /** 幂等键：接收端按此去重（重连补拉/重发不产生重复副作用） */
  msgId: string;
  /** 设备对标识（配对后由服务端签发；未配对设备间信令无效） */
  pairId: string;
  from: {
    deviceId: string;
    name: string;
    type: DeviceType;
  };
  kind: DeviceLinkKind;
  payload: T;
  ts: number;
}

// ---------- 补拉（P0-3：relay 推送即删的丢失问题）----------

export interface SyncRequestPayload {
  /** 回放该时刻之后的互联事件 */
  sinceTs: number;
}

/** 单条互联事件（sync.delta 回放的最小单元；桌面端本地日志持久化） */
export interface DeviceLinkEvent<T = unknown> {
  msgId: string;
  pairId: string;
  kind: DeviceLinkKind;
  payload: T;
  ts: number;
}

export interface SyncDeltaPayload {
  events: DeviceLinkEvent[];
  /** true = 还有后续分片（接收端继续等）；false = 本轮补拉结束 */
  hasMore: boolean;
}

// ---------- 配对（L2，服务端 device_pairs 模型的客户端可见部分）----------

/** 配对码信息（POST /api/pairs/code 响应；5 分钟有效） */
export interface PairCodeInfo {
  code: string;          // 6 位数字码（手机输入用）
  desktopDeviceId: string;
  /** 一次性公钥指纹（为 E2EE 互联预留 X3DH 入口；v1 仅展示核对） */
  publicKeyFingerprint?: string;
  expiresAt: number;
}

/** 配对完成后的设备对投影 */
export interface DevicePair {
  id: string;
  userId: string;
  desktopDeviceId: string;
  mobileDeviceId: string;
  pairedAt: number;
}

/** 类型守卫：任意载荷是否为合法的 v1 互联信封（接收端入口校验） */
export function isDeviceLinkEnvelope(x: unknown): x is DeviceLinkEnvelope {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Record<string, unknown>;
  const from = e.from as Record<string, unknown> | undefined;
  return (
    e.v === 1 &&
    typeof e.msgId === "string" && (e.msgId as string).length > 0 &&
    typeof e.pairId === "string" &&
    typeof e.kind === "string" &&
    typeof from?.deviceId === "string" &&
    typeof e.ts === "number"
  );
}
