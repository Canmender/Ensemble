/**
 * per-user 插件管理器（R4，用户主权模型：插件是用户资产，云端只做中转）。
 *
 * 架构决策（规避"PluginHost 单例假设"风险）：内核零改动——每个 (userId, pluginId)
 * 实例 = PluginHost 里一个命名空间化插件 `user:<userId>:<pluginId>`。
 * 隔离由本层保证：kv 视图按三元键限定、timer 上限按用户计数、disable 即 unregister
 * 该命名空间实例（其他用户零感知）。
 *
 * 性能闸门（《性能工程》§三 定死值）：
 * - 每用户 timer 上限 20（mount 时校验 manifest.scheduled 计数）
 * - 监听器超时：同步 50ms / 异步 3s（kernel 层 waterfallAsync 已有容错；闸门在 mount 校验层）
 */
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import type { PluginHost, EnsemblePlugin } from "./kernel";
import type { PluginUserKv } from "./user-kv";
import { logger } from "../util/logger";

// ---------- manifest schema（清单即权限）----------

export const pluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, "id 须为小写字母开头的 kebab-case"),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "version 须为 semver"),
  description: z.string().optional(),
  /** 声明的定时任务数（用于每用户 timer 上限校验） */
  scheduled: z.number().int().min(0).max(5).default(0),
  /** 声明监听的事件（须命中白名单前缀，见 events.ts） */
  eventsOn: z.array(z.string()).default([]),
  /**
   * 设置页配置表单的字段声明（U1 演进项落地：manifest 即 UI）。
   * web 端按此自动渲染表单——插件新增配置项无需改前端代码。
   */
  settings: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    placeholder: z.string().optional(),
    type: z.enum(["text", "password"]).default("text"),
  })).default([]),
});

/** 声明侧类型：scheduled/eventsOn/settings 可省略（schema 解析时补默认值） */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  scheduled?: number;
  eventsOn?: string[];
  settings?: Array<{ key: string; label: string; placeholder?: string; type?: "text" | "password" }>;
}

/** 解析后的完整 manifest（schema.parse 输出，default 已补齐） */
export type ResolvedManifest = z.infer<typeof pluginManifestSchema>;

/** 每用户可同时启用的定时任务上限 */
export const USER_TIMER_CAP = 20;

// ---------- 用户插件记录 ----------

interface UserPluginRow {
  user_id: string;
  plugin_id: string;
  config_json: string | null;
  enabled: number;
}

/** 插件运行时上下文：传给用户实例的 create 工厂 */
export interface UserPluginRuntime {
  manifest: PluginManifest;
  userId: string;
  kv: PluginUserKv;
  config: unknown;
}

/** 候选插件定义（服务器本地 plugins/ 目录的管理员预置集） */
export interface CandidatePlugin {
  manifest: PluginManifest;
  /** 工厂：给运行时上下文，返回 EnsemblePlugin 实例体 */
  create: (runtime: UserPluginRuntime) => Omit<EnsemblePlugin, "name">;
}

/** 注册后的候选（manifest 已解析补默认值） */
type ResolvedCandidate = CandidatePlugin & { manifest: ResolvedManifest };

export class PerUserPluginManager {
  /** 候选集：pluginId → 定义 */
  private candidates = new Map<string, ResolvedCandidate>();
  /** 每用户已启用计数（timer 闸门用） */
  private activeTimers = new Map<string, number>();

  constructor(
    private host: PluginHost,
    private db: DatabaseSync,
    private makeKv: (userId: string, pluginId: string) => PluginUserKv,
  ) {}

  /** 注册候选插件：manifest 经 schema 解析（校验 + 补默认值），失败抛错（fail-fast） */
  registerCandidate(candidate: CandidatePlugin): void {
    const parsed = pluginManifestSchema.parse(candidate.manifest);
    this.candidates.set(parsed.id, { ...candidate, manifest: parsed });
  }

  listCandidates(): ResolvedManifest[] {
    return [...this.candidates.values()].map((c) => c.manifest);
  }

  /** 某用户的启用清单（含配置与状态投影 + settings 表单声明透传） */
  listForUser(userId: string): Array<{
    id: string; name: string; version: string; description?: string;
    enabled: boolean; hasConfig: boolean; scheduled: number;
    settings: PluginManifest["settings"];
  }> {
    const rows = this.db
      .prepare("SELECT user_id, plugin_id, config_json, enabled FROM user_plugins WHERE user_id = ?")
      .all(userId) as unknown as UserPluginRow[];
    return rows.flatMap((r) => {
      const c = this.candidates.get(r.plugin_id);
      if (!c) return []; // 候选被移除的残留行不展示
      return [{
        id: c.manifest.id,
        name: c.manifest.name,
        version: c.manifest.version,
        description: c.manifest.description,
        enabled: !!r.enabled && this.host.statusOf(this.instanceName(userId, r.plugin_id)).status === "active",
        hasConfig: !!r.config_json,
        scheduled: c.manifest.scheduled,
        settings: c.manifest.settings,
      }];
    });
  }

  /**
   * 启用插件：在该用户作用域 mount 一个实例。
   * 幂等（已启用直接返回）；候选不存在/超 timer 闸门则拒绝。
   */
  async enable(userId: string, pluginId: string): Promise<{ ok: boolean; error?: string }> {
    const candidate = this.candidates.get(pluginId);
    if (!candidate) return { ok: false, error: `插件不存在: ${pluginId}` };

    const existing = this.getUserRow(userId, pluginId);
    if (!existing) {
      this.db.prepare("INSERT INTO user_plugins (user_id, plugin_id, enabled, updated_at) VALUES (?, ?, 1, ?)")
        .run(userId, pluginId, new Date().toISOString());
    } else {
      this.db.prepare("UPDATE user_plugins SET enabled = 1, updated_at = ? WHERE user_id = ? AND plugin_id = ?")
        .run(new Date().toISOString(), userId, pluginId);
    }

    return this.mount(userId, pluginId, candidate);
  }

  /** 禁用插件：unregister 该用户命名空间实例（其他用户零感知） */
  async disable(userId: string, pluginId: string): Promise<void> {
    await this.unmount(userId, pluginId);
    this.db.prepare("UPDATE user_plugins SET enabled = 0, updated_at = ? WHERE user_id = ? AND plugin_id = ?")
      .run(new Date().toISOString(), userId, pluginId);
  }

  /** 更新用户级插件配置并热重启该实例（fiber.update 语义的显式版） */
  async setConfig(userId: string, pluginId: string, config: unknown): Promise<boolean> {
    const candidate = this.candidates.get(pluginId);
    if (!candidate) return false;
    this.db.prepare("INSERT INTO user_plugins (user_id, plugin_id, config_json, enabled, updated_at) VALUES (?, ?, ?, 1, ?) "
      + "ON CONFLICT(user_id, plugin_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at")
      .run(userId, pluginId, JSON.stringify(config ?? {}), new Date().toISOString());
    // 热重启：dispose 后带新配置重挂
    await this.unmount(userId, pluginId);
    const r = await this.mount(userId, pluginId, candidate);
    return r.ok;
  }

  getUserConfig(userId: string, pluginId: string): unknown {
    const row = this.getUserRow(userId, pluginId);
    if (!row?.config_json) return {};
    try {
      return JSON.parse(row.config_json);
    } catch {
      return {};
    }
  }

  /** 服务器启动时恢复全部用户的已启用插件 */
  async restoreAll(): Promise<void> {
    const rows = this.db
      .prepare("SELECT user_id, plugin_id FROM user_plugins WHERE enabled = 1")
      .all() as unknown as Array<{ user_id: string; plugin_id: string }>;
    for (const r of rows) {
      const result = await this.mount(r.user_id, r.plugin_id);
      if (!result.ok) {
        logger.warn(`[plugins] restore ${r.plugin_id} for ${r.user_id} failed: ${result.error}`);
      }
    }
    if (rows.length > 0) logger.info(`[plugins] restored ${rows.length} user plugin instance(s)`);
  }

  // ---------- 内部：mount/unmount ----------

  private async mount(userId: string, pluginId: string, candidate?: ResolvedCandidate): Promise<{ ok: boolean; error?: string }> {
    const c = candidate ?? this.candidates.get(pluginId);
    if (!c) return { ok: false, error: `插件不存在: ${pluginId}` };

    // 性能闸门：该用户当前 timer 数 + 本插件声明数 ≤ 上限
    const used = this.activeTimers.get(userId) ?? 0;
    if (used + c.manifest.scheduled > USER_TIMER_CAP) {
      return { ok: false, error: `超出每用户定时任务上限（${USER_TIMER_CAP}），请先禁用部分插件` };
    }

    const instanceName = this.instanceName(userId, pluginId);
    const body = c.create({
      manifest: c.manifest,
      userId,
      kv: this.makeKv(userId, pluginId),
      config: this.getUserConfig(userId, pluginId),
    });
    const ok = await this.host.register({
      name: instanceName,
      inject: body.inject,
      softInject: body.softInject,
      install: (ctx) => body.install(ctx),
    });
    if (ok) {
      this.activeTimers.set(userId, used + c.manifest.scheduled);
      logger.info(`[plugins] mounted ${pluginId} for user ${userId}`);
    }
    return { ok, error: ok ? undefined : this.host.statusOf(instanceName).error };
  }

  private async unmount(userId: string, pluginId: string): Promise<void> {
    const c = this.candidates.get(pluginId);
    await this.host.unregister(this.instanceName(userId, pluginId));
    if (c) {
      const used = Math.max(0, (this.activeTimers.get(userId) ?? 0) - c.manifest.scheduled);
      this.activeTimers.set(userId, used);
    }
    logger.info(`[plugins] unmounted ${pluginId} for user ${userId}`);
  }

  private instanceName(userId: string, pluginId: string): string {
    return `user:${userId}:${pluginId}`;
  }

  private getUserRow(userId: string, pluginId: string): UserPluginRow | undefined {
    return this.db
      .prepare("SELECT user_id, plugin_id, config_json, enabled FROM user_plugins WHERE user_id = ? AND plugin_id = ?")
      .get(userId, pluginId) as UserPluginRow | undefined;
  }
}
