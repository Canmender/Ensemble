/**
 * 设置页「插件」面板（R4-D）：候选列表 + 每用户启停开关 + 配置表单。
 * 数据面 = /api/users/me/plugins（per-user 主权模型：插件是用户资产）。
 */
import { useCallback, useEffect, useState } from "react";
import { Blocks, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { Button, Card, Input, Label, Modal, Spinner, showToast } from "../components/ui";

interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  scheduled: number;
  enabled: boolean;
  hasConfig: boolean;
  /** manifest 内嵌的配置表单字段声明（manifest 即 UI——插件新增配置项无需改前端） */
  settings?: Array<{ key: string; label: string; placeholder?: string; type?: "text" | "password" }>;
}

export function PluginsPanel() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [configFor, setConfigFor] = useState<PluginInfo | null>(null);
  const [configDraft, setConfigDraft] = useState<Record<string, string>>({});
  const [savingConfig, setSavingConfig] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setPlugins(await api.get<PluginInfo[]>("/users/me/plugins"));
    } catch (e) {
      // 本地模式无用户身份：接口 403，静默显示空态
      console.warn("加载插件失败:", e);
      setPlugins([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggle(p: PluginInfo) {
    setBusyId(p.id);
    try {
      await api.post(`/users/me/plugins/${p.id}/${p.enabled ? "disable" : "enable"}`);
      showToast(p.enabled ? `已禁用 ${p.name}` : `已启用 ${p.name}`);
      await refresh();
    } catch (e) {
      showToast((e as Error).message || "操作失败", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function openConfig(p: PluginInfo) {
    try {
      const cfg = await api.get<Record<string, unknown>>(`/users/me/plugins/${p.id}/config`);
      const draft: Record<string, string> = {};
      for (const f of p.settings ?? []) draft[f.key] = String(cfg?.[f.key] ?? "");
      setConfigDraft(draft);
      setConfigFor(p);
    } catch {
      setConfigDraft({});
      setConfigFor(p);
    }
  }

  async function saveConfig() {
    if (!configFor) return;
    setSavingConfig(true);
    try {
      await api.put(`/users/me/plugins/${configFor.id}/config`, { config: configDraft });
      showToast("配置已保存并生效");
      setConfigFor(null);
      await refresh();
    } catch (e) {
      showToast((e as Error).message || "保存失败", "error");
    } finally {
      setSavingConfig(false);
    }
  }

  if (loading) return <Spinner label="加载插件中…" />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Blocks className="h-4 w-4" />
        <span>插件是你的个人资产：启用后只在你自己的作用域内运行，其他人不受影响。</span>
      </div>

      {plugins.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">
          暂无可用插件（服务器本地 plugins/ 目录为管理员预置的候选集）
        </Card>
      ) : (
        plugins.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-fg">{p.name}</span>
                  <span className="text-[10px] text-muted">v{p.version}</span>
                  {p.scheduled > 0 && (
                    <span className="rounded bg-muted/10 px-1.5 py-0.5 text-[10px] text-muted">定时 ×{p.scheduled}</span>
                  )}
                </div>
                {p.description && <div className="mt-0.5 text-xs text-muted">{p.description}</div>}
              </div>
              {(p.settings?.length ?? 0) > 0 && (
                <Button variant="secondary" className="!px-2.5 !py-1 text-xs" onClick={() => void openConfig(p)}>
                  配置
                </Button>
              )}
              {/* 启停开关 */}
              <button
                onClick={() => void toggle(p)}
                disabled={busyId === p.id}
                role="switch"
                aria-checked={p.enabled}
                aria-label={`${p.enabled ? "禁用" : "启用"} ${p.name}`}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                  p.enabled ? "bg-primary" : "bg-muted/30"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    p.enabled ? "translate-x-[22px]" : "translate-x-0.5"
                  }`}
                />
              </button>
              {busyId === p.id && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
            </div>
          </Card>
        ))
      )}

      {/* 配置表单 */}
      <Modal open={!!configFor} onClose={() => setConfigFor(null)} title={configFor ? `${configFor.name} 配置` : ""}>
        {configFor && (
          <div className="space-y-4">
            {(configFor.settings ?? []).map((f) => (
              <div key={f.key}>
                <Label>{f.label}</Label>
                <Input
                  type={f.type ?? "text"}
                  value={configDraft[f.key] ?? ""}
                  onChange={(e) => setConfigDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                />
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfigFor(null)}>取消</Button>
              <Button variant="primary" onClick={() => void saveConfig()} disabled={savingConfig}>
                {savingConfig ? "保存中…" : "保存并生效"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
