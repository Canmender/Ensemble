/**
 * 互联事件本地日志（L1）：桌面端把收发的互联信令落库（device_link_events 表），
 * 手机断线重连后按 sinceTs 回放 delta——解决 relay「推送即删」的丢失问题
 * （与 IM 主链路 afterSeq 同构的设计模式）。
 */
import type { DatabaseSync } from "node:sqlite";
import type { DeviceLinkEvent, DeviceLinkKind } from "@ensemble/shared";

export class DeviceLinkLog {
  constructor(private db: DatabaseSync) {}

  /** 记录一条互联事件（发送/接收均记；幂等键 msgId 重复忽略） */
  append(ev: { msgId: string; pairId: string; kind: DeviceLinkKind; payload: unknown; ts: number }): void {
    this.db
      .prepare("INSERT OR IGNORE INTO device_link_events (msg_id, pair_id, kind, payload_json, ts) VALUES (?, ?, ?, ?, ?)")
      .run(ev.msgId, ev.pairId, ev.kind, JSON.stringify(ev.payload ?? null), ev.ts);
  }

  /** 回放某设备对在 sinceTs 之后的事件（升序，单页上限 500） */
  replay(pairId: string, sinceTs: number): { events: DeviceLinkEvent[]; hasMore: boolean } {
    const rows = this.db
      .prepare("SELECT msg_id, pair_id, kind, payload_json, ts FROM device_link_events WHERE pair_id = ? AND ts > ? ORDER BY ts ASC LIMIT 501")
      .all(pairId, sinceTs) as Array<{ msg_id: string; pair_id: string; kind: string; payload_json: string | null; ts: number }>;
    const hasMore = rows.length > 500;
    const page = hasMore ? rows.slice(0, 500) : rows;
    return {
      events: page.map((r) => ({
        msgId: r.msg_id,
        pairId: r.pair_id,
        kind: r.kind as DeviceLinkKind,
        payload: r.payload_json ? JSON.parse(r.payload_json) : null,
        ts: r.ts,
      })),
      hasMore,
    };
  }

  /** 清理 N 天前的旧事件（维护定时器调用） */
  cleanup(olderThanMs: number): number {
    return Number(this.db.prepare("DELETE FROM device_link_events WHERE ts < ?").run(Date.now() - olderThanMs).changes);
  }
}
