/**
 * 插件 KV 存储的 per-user 命名空间视图（R4 §A）。
 * 物理表 plugin_kv 主键 (user_id, plugin_id, key)；本类把前两元固化，
 * 插件拿到的 get/set/list/del 自动限定在自己的命名空间内——拿不到别人的数据。
 */
import type { DatabaseSync } from "node:sqlite";

export class PluginUserKv {
  constructor(
    private db: DatabaseSync,
    private userId: string,
    private pluginId: string,
  ) {}

  get<T>(key: string): T | undefined {
    const row = this.db
      .prepare("SELECT value_json FROM plugin_kv WHERE user_id = ? AND plugin_id = ? AND key = ?")
      .get(this.userId, this.pluginId, key) as { value_json: string | null } | undefined;
    if (!row || row.value_json === null) return undefined;
    try {
      return JSON.parse(row.value_json) as T;
    } catch {
      return undefined;
    }
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare("INSERT INTO plugin_kv (user_id, plugin_id, key, value_json, updated_at) VALUES (?, ?, ?, ?, ?) "
        + "ON CONFLICT(user_id, plugin_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at")
      .run(this.userId, this.pluginId, key, JSON.stringify(value ?? null), new Date().toISOString());
  }

  del(key: string): void {
    this.db.prepare("DELETE FROM plugin_kv WHERE user_id = ? AND plugin_id = ? AND key = ?")
      .run(this.userId, this.pluginId, key);
  }

  /** 本命名空间全部键值（插件自己的数据遍历） */
  list(): Record<string, unknown> {
    const rows = this.db
      .prepare("SELECT key, value_json FROM plugin_kv WHERE user_id = ? AND plugin_id = ?")
      .all(this.userId, this.pluginId) as Array<{ key: string; value_json: string | null }>;
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        out[r.key] = r.value_json === null ? null : JSON.parse(r.value_json);
      } catch {
        out[r.key] = null;
      }
    }
    return out;
  }
}
