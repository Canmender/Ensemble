/**
 * 「功能」页（用户主权插件的客户端主门面）：
 * - 插件候选 Bento 卡片网格（名称/描述/版本/启停/配置入口）
 * - manifest.settings 自动渲染配置表单
 * - 本地模式（无用户身份）：登录引导空态
 * - 预留扩展位：U5 市场入口区、manifest.ui 贡献的 UI 插槽
 */
import { useCallback, useEffect, useState } from "react";
import { Blocks, LogIn, Loader2, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
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

export default function PluginsPage() {
  const { state } = useAuth();
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

  const localMode = state.status !== "authenticated";

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
          <Blocks className="h-6 w-6 text-primary" /> 功能
        </h1>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
          <Sparkles className="h-3.5 w-3.5" />
          功能由你自定义——启用后只在你的作用域内运行，其他人不受影响
        </p>
      </header>

      {/* 本地模式：登录引导态 */}
      {localMode && !loading ? (
        <Card className="p-10 text-center">
          <LogIn className="mx-auto h-10 w-10 text-muted/40" />
          <p className="mt-3 text-sm font-medium text-fg">登录后可用 · 功能由你自定义</p>
          <p className="mt-1 text-xs text-muted">云端版登录账号后，即可启用属于你的插件与扩展</p>
          <Button variant="primary" className="mt-4" onClick={() => (window.location.href = "/login")}>
            前往登录
          </Button>
        </Card>
      ) : loading ? (
        <Spinner label="加载功能中…" />
      ) : (
        <>
          {plugins.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted">
              暂无可用功能（服务器本地候选集为管理员预置；市场安装能力即将上线）
            </Card>
          ) : (
            /* Bento 网格：自适应列宽，卡片高度随内容舒展 */
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plugins.map((p) => (
                <Card key={p.id} className="flex flex-col p-5 transition-shadow hover:shadow-card-hover">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-fg">{p.name}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted">
                        <span>v{p.version}</span>
                        {p.scheduled > 0 && (
                          <span className="rounded bg-muted/10 px-1.5 py-0.5">定时 ×{p.scheduled}</span>
                        )}
                      </div>
                    </div>
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
                  </div>
                  {p.description && <p className="mt-2 flex-1 text-xs leading-relaxed text-muted">{p.description}</p>}
                  <div className="mt-3 flex items-center justify-between">
                    <span className={`text-[10px] font-medium ${p.enabled ? "text-success" : "text-muted"}`}>
                      {p.enabled ? "● 已启用" : "○ 未启用"}
                    </span>
                    {(p.settings?.length ?? 0) > 0 && (
                      <Button variant="secondary" className="!px-2.5 !py-1 text-xs" onClick={() => void openConfig(p)}>
                        配置
                      </Button>
                    )}
                    {busyId === p.id && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* U5 预留位：市场入口（浏览/安装第三方插件）挂载点 */}
        </>
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
