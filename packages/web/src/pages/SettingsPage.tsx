import { useEffect, useState } from "react";
import { Cloud, Globe, Pencil, Plug, Settings, Trash2, Wrench } from "lucide-react";
import { api } from "../lib/api";
import type { AppSettings, ProviderConfig } from "../types";
import {
  Badge, Button, Card, Input, Label, Modal, Select, Spinner, cls,
} from "../components/ui";

const TYPE_LABEL: Record<string, string> = {
  anthropic: "Anthropic Claude",
  openai: "OpenAI 兼容",
  custom: "自定义端点",
};

// ---------- Provider 表单 ----------
function ProviderForm({ initial, onDone }: { initial?: ProviderConfig; onDone: () => void }) {
  const [form, setForm] = useState({
    id: initial?.id ?? "",
    name: initial?.name ?? "",
    type: (initial?.type ?? "anthropic") as ProviderConfig["type"],
    baseUrl: initial?.baseUrl ?? "",
    apiKey: "",
    defaultModel: initial?.defaultModel ?? "",
    enabled: initial?.enabled ?? true,
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    if (!form.id.trim() || !form.name.trim()) return;
    const body: any = {
      id: form.id,
      name: form.name,
      type: form.type,
      baseUrl: form.baseUrl || undefined,
      defaultModel: form.defaultModel || undefined,
      enabled: form.enabled,
    };
    if (form.apiKey) body.apiKey = form.apiKey;
    if (initial) await api.put(`/providers/${initial.id}`, body);
    else await api.post("/providers", body);
    onDone();
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.post<{ ok: boolean; message: string }>(`/providers/${initial?.id ?? form.id}/test`);
      setTestResult(r.ok ? `✅ ${r.message}` : `❌ ${r.message}`);
    } catch (e) {
      setTestResult(`❌ ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>ID</Label>
          <Input value={form.id} onChange={(e) => set({ id: e.target.value })} placeholder="anthropic-main" disabled={!!initial} />
        </div>
        <div>
          <Label>名称</Label>
          <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="我的 Claude" />
        </div>
      </div>
      <div>
        <Label>类型</Label>
        <Select value={form.type} onChange={(e) => set({ type: e.target.value as any })}>
          <option value="anthropic">Anthropic Claude（官方 API）</option>
          <option value="openai">OpenAI 兼容（OpenRouter / DeepSeek / Ollama）</option>
          <option value="custom">自定义端点（OpenAI 兼容协议）</option>
        </Select>
      </div>
      {form.type !== "anthropic" && (
        <div>
          <Label>Base URL</Label>
          <Input value={form.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://openrouter.ai/api/v1 或 http://localhost:11434/v1" />
        </div>
      )}
      <div>
        <Label>API Key {initial?.apiKeySet && <span className="text-emerald-600">（已配置）</span>}</Label>
        <Input type="password" value={form.apiKey} onChange={(e) => set({ apiKey: e.target.value })} placeholder={initial?.apiKeySet ? "留空保持不变" : "sk-…"} />
      </div>
      <div>
        <Label>默认模型（可选）</Label>
        <Input value={form.defaultModel} onChange={(e) => set({ defaultModel: e.target.value })} placeholder="claude-sonnet-4-5 / deepseek-chat" />
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <div className="flex items-center gap-3">
          <Button onClick={test} disabled={testing || !(initial?.apiKeySet || form.apiKey)} variant="secondary" className="px-3 py-1.5 text-xs">
            {testing ? <Spinner label="测试中" /> : "测试连接"}
          </Button>
          {testResult && <span className="max-w-[240px] truncate text-xs text-muted">{testResult}</span>}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={!!form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            启用
          </label>
          <Button onClick={onDone} variant="ghost">取消</Button>
          <Button variant="primary" onClick={save}>保存</Button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState<"providers" | "tools" | "general">("providers");
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ProviderConfig | undefined>();
  const [fetchingModels, setFetchingModels] = useState<string | null>(null);

  async function refresh() {
    const [p, s] = await Promise.all([api.get<ProviderConfig[]>("/providers"), api.get<AppSettings>("/settings")]);
    setProviders(p ?? []);
    setSettings(s);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function remove(id: string) {
    if (!confirm(`确定删除 provider ${id}？`)) return;
    await api.del(`/providers/${id}`);
    void refresh();
  }

  async function fetchModels(id: string) {
    setFetchingModels(id);
    try {
      const d = await api.get<{ models: string[] }>(`/providers/${id}/models`);
      const cur = providers.find((p) => p.id === id);
      if (d?.models?.length) {
        await api.put(`/providers/${id}`, { ...cur, models: d.models });
        void refresh();
      }
    } finally {
      setFetchingModels(null);
    }
  }

  async function saveSettings(patch: Partial<AppSettings>) {
    await api.put("/settings", { ...settings, ...patch });
    void refresh();
  }

  const tabs = [
    { key: "providers" as const, label: "LLM Providers", icon: <Plug className="h-4 w-4" /> },
    { key: "tools" as const, label: "工具与安全", icon: <Wrench className="h-4 w-4" /> },
    { key: "general" as const, label: "通用", icon: <Settings className="h-4 w-4" /> },
  ];

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-fg">设置</h1>
        <p className="mt-1 text-sm text-muted">配置模型提供商、Agent 工具与工作区</p>
      </header>

      <div className="mb-6 flex gap-1 rounded-xl bg-muted/10 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cls(
              "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              tab === t.key ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "providers" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">添加 Anthropic、OpenAI 兼容（OpenRouter/DeepSeek/Ollama）或自定义端点</p>
            <Button variant="primary" onClick={() => { setEditing(undefined); setShowForm(true); }} className="px-3 py-1.5 text-sm">
              + 添加 Provider
            </Button>
          </div>

          {providers.length === 0 && (
            <Card className="p-8 text-center text-sm text-muted">还没有 Provider，点击右上角添加</Card>
          )}

          {providers.map((p) => (
            <Card key={p.id} className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/10 text-primary">
                    {p.type === "anthropic" ? <Cloud className="h-5 w-5" /> : <Globe className="h-5 w-5" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-fg">{p.name}</span>
                      <Badge color={p.enabled ? "green" : "ink"}>{p.enabled ? "启用" : "停用"}</Badge>
                    </div>
                    <div className="text-xs text-muted">
                      {TYPE_LABEL[p.type] ?? p.type} · {p.id}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => fetchModels(p.id)} disabled={fetchingModels === p.id}>
                    {fetchingModels === p.id ? "拉取中…" : "拉取模型"}
                  </Button>
                  <button onClick={() => { setEditing(p); setShowForm(true); }} className="rounded-md p-1.5 text-muted hover:bg-muted/10 hover:text-fg" title="编辑">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => remove(p.id)} className="rounded-md p-1.5 text-muted hover:bg-destructive/10 hover:text-destructive" title="删除">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                {p.baseUrl && <span className="rounded bg-bg px-2 py-0.5 font-mono">{p.baseUrl}</span>}
                <span className={cls("rounded px-2 py-0.5", p.apiKeySet ? "bg-emerald-50 text-emerald-600" : "bg-bg text-muted")}>
                  {p.apiKeySet ? "● API Key 已配置" : "○ 未配置 Key"}
                </span>
                {p.defaultModel && <span className="rounded bg-primary/10 px-2 py-0.5 text-primary">{p.defaultModel}</span>}
              </div>
              {p.models && p.models.length > 0 && (
                <details className="mt-2 text-xs text-muted">
                  <summary className="cursor-pointer hover:text-fg">已缓存的 {p.models.length} 个模型</summary>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.models.slice(0, 30).map((m) => (
                      <span key={m} className="rounded bg-bg px-1.5 py-0.5 font-mono">{m}</span>
                    ))}
                  </div>
                </details>
              )}
            </Card>
          ))}
        </div>
      )}

      {tab === "tools" && settings && (
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="mb-1 text-sm font-semibold text-fg">工作区根目录（工具白名单）</h3>
            <p className="mb-3 text-xs text-muted">Agent 的文件读写 / 命令执行默认只能访问此目录</p>
            <div className="flex gap-2">
              <Input value={settings.workspaceRoot} onChange={(e) => saveSettings({ workspaceRoot: e.target.value })} placeholder="留空则无文件访问" />
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-1 text-sm font-semibold text-fg">命令执行确认策略</h3>
            <p className="mb-3 text-xs text-muted">Agent 执行 shell 命令前是否需要弹窗确认</p>
            <Select value={settings.codeExecutionConfirm} onChange={(e) => saveSettings({ codeExecutionConfirm: e.target.value as any })}>
              <option value="ask">每次询问（推荐）</option>
              <option value="always">总是自动允许</option>
              <option value="never">总是拒绝</option>
            </Select>
          </Card>

          <Card className="p-5">
            <h3 className="mb-1 text-sm font-semibold text-fg">联网搜索（可选）</h3>
            <p className="mb-3 text-xs text-muted">不配置则使用 DuckDuckGo 免费接口</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>搜索服务</Label>
                <Select value={settings.searchApi?.provider ?? "duckduckgo"} onChange={(e) => saveSettings({ searchApi: { provider: e.target.value as "duckduckgo" | "serper", apiKey: settings.searchApi?.apiKey } })}>
                  <option value="duckduckgo">DuckDuckGo（免费）</option>
                  <option value="serper">Serper.dev</option>
                </Select>
              </div>
              <div>
                <Label>API Key</Label>
                <Input type="password" value={settings.searchApi?.apiKey ?? ""} onChange={(e) => saveSettings({ searchApi: { provider: settings.searchApi?.provider ?? "duckduckgo", apiKey: e.target.value } })} placeholder="serper key" />
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === "general" && (
        <Card className="p-5">
          <h3 className="mb-1 text-sm font-semibold text-fg">配置目录</h3>
          <p className="mb-3 text-xs text-muted">Agent 配置、Provider 配置、数据库等存储位置</p>
          {(window as any).desktop?.openConfigDir ? (
            <Button variant="secondary" onClick={() => (window as any).desktop.openConfigDir()}>打开配置目录</Button>
          ) : (
            <span className="text-xs text-muted">（浏览器模式下不可用）</span>
          )}
        </Card>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? "编辑 Provider" : "添加 Provider"} wide>
        <ProviderForm
          initial={editing}
          onDone={() => {
            setShowForm(false);
            void refresh();
          }}
        />
      </Modal>
    </div>
  );
}
