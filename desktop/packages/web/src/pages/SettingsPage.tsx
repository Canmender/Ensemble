import { useEffect, useState } from "react";
import { BookOpen, Cloud, Download, Globe, Pencil, Plug, Server, Settings, Trash2, Wrench } from "lucide-react";
import { api } from "../lib/api";
import type { AppSettings, DetectedAgent, McpServerConfig, ProviderConfig, SkillDef, SyncResult } from "../types";
import {
  Badge, Button, Card, Input, Label, Modal, Select, Spinner, Textarea, cls,
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

// ---------- MCP Server 表单 ----------
function McpForm({ initial, onDone }: { initial?: McpServerConfig; onDone: () => void }) {
  const [form, setForm] = useState({
    id: initial?.id ?? "",
    name: initial?.name ?? "",
    transport: (initial?.transport ?? "stdio") as McpServerConfig["transport"],
    command: initial?.command ?? "",
    args: (initial?.args ?? []).join(" "),
    url: initial?.url ?? "",
    headers: initial?.headers ? JSON.stringify(initial.headers) : "",
    maxTools: initial?.maxTools ?? 25,
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    if (!form.id.trim() || !form.name.trim()) return;
    const body: any = {
      id: form.id,
      name: form.name,
      transport: form.transport,
      maxTools: Number(form.maxTools) || 25,
      enabled: true,
    };
    if (form.transport === "stdio") {
      body.command = form.command;
      body.args = form.args.split(/\s+/).filter(Boolean);
    } else {
      body.url = form.url;
      if (form.headers.trim()) {
        try {
          body.headers = JSON.parse(form.headers);
        } catch {
          setTestResult("headers JSON 解析失败");
          return;
        }
      }
    }
    if (initial) await api.put(`/mcp/${initial.id}`, body);
    else await api.post("/mcp", body);
    onDone();
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.post<{ ok: boolean; message: string }>(`/mcp/${initial?.id ?? form.id}/test`);
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
        <div><Label>ID</Label><Input value={form.id} onChange={(e) => set({ id: e.target.value })} placeholder="my-tools" disabled={!!initial} /></div>
        <div><Label>名称</Label><Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="我的工具集" /></div>
      </div>
      <div>
        <Label>传输方式</Label>
        <Select value={form.transport} onChange={(e) => set({ transport: e.target.value as any })}>
          <option value="stdio">stdio（本地进程）</option>
          <option value="http">HTTP（Streamable）</option>
        </Select>
      </div>
      {form.transport === "stdio" ? (
        <>
          <div>
            <Label>命令</Label>
            <Input value={form.command} onChange={(e) => set({ command: e.target.value })} placeholder="node / npx / python …" />
          </div>
          <div>
            <Label>参数（空格分隔）</Label>
            <Input value={form.args} onChange={(e) => set({ args: e.target.value })} placeholder="server.js 或 npx -y @xxx/mcp" />
          </div>
        </>
      ) : (
        <>
          <div>
            <Label>URL</Label>
            <Input value={form.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://mcp.example.com/mcp" />
          </div>
          <div>
            <Label>Headers（JSON）</Label>
            <Input value={form.headers} onChange={(e) => set({ headers: e.target.value })} placeholder='{"Authorization": "Bearer …"}' />
          </div>
        </>
      )}
      <div>
        <Label>最多加载工具数</Label>
        <Input type="number" value={form.maxTools} onChange={(e) => set({ maxTools: Number(e.target.value) })} />
      </div>
      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button onClick={test} disabled={testing} variant="secondary" className="px-3 py-1.5 text-xs">
          {testing ? <Spinner label="测试中" /> : "测试连接"}
        </Button>
        {testResult && <span className="max-w-[240px] truncate text-xs text-muted">{testResult}</span>}
        <div className="flex gap-2">
          <Button onClick={onDone} variant="ghost">取消</Button>
          <Button variant="primary" onClick={save}>保存</Button>
        </div>
      </div>
    </div>
  );
}

// ---------- MCP 列表 ----------
function McpSection() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<McpServerConfig | undefined>();

  async function refresh() {
    setServers(await api.get<McpServerConfig[]>("/mcp"));
  }

  useEffect(() => { void refresh(); }, []);

  async function remove(id: string) {
    if (!confirm(`确定删除 MCP server ${id}？`)) return;
    await api.del(`/mcp/${id}`);
    void refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">接入 MCP 工具服务器（stdio / HTTP）</p>
        <Button variant="primary" onClick={() => { setEditing(undefined); setShowForm(true); }} className="px-3 py-1.5 text-sm">
          + 添加 MCP Server
        </Button>
      </div>

      {servers.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted">还没有 MCP server，点击右上角添加</Card>
      )}

      {servers.map((s) => (
        <Card key={s.id} className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Server className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-fg">{s.name}</span>
                  <Badge color={s.transport === "stdio" ? "brand" : "violet"}>{s.transport}</Badge>
                </div>
                <div className="text-xs text-muted">
                  {s.transport === "stdio" ? s.command : s.url} · {s.id}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-xs">
                <span className={cls("h-2 w-2 rounded-full", s.status?.connected ? "bg-success" : "bg-destructive")} />
                <span className={cls("font-medium", s.status?.connected ? "text-success" : "text-destructive")}>
                  {s.status?.connected ? `${s.status.toolCount} tools` : s.status?.error?.slice(0, 30) ?? "未连接"}
                </span>
              </span>
              <button onClick={() => { setEditing(s); setShowForm(true); }} className="rounded-md p-1.5 text-muted hover:bg-muted/10 hover:text-fg" title="编辑">
                <Pencil className="h-4 w-4" />
              </button>
              <button onClick={() => remove(s.id)} className="rounded-md p-1.5 text-muted hover:bg-destructive/10 hover:text-destructive" title="删除">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </Card>
      ))}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? "编辑 MCP Server" : "添加 MCP Server"} wide>
        <McpForm
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

// ---------- Skill 表单 ----------
function SkillForm({ initial, onDone }: { initial?: SkillDef; onDone: () => void }) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    body: initial?.body ?? "",
  });

  async function save() {
    if (!form.name.trim() || !form.description.trim() || !form.body.trim()) return;
    const body = { name: form.name, description: form.description, body: form.body };
    if (initial) await api.put(`/skills/${initial.name}`, body);
    else await api.post("/skills", body);
    onDone();
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>名称（小写字母/数字/连字符）</Label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="code-review" disabled={!!initial} />
      </div>
      <div>
        <Label>描述（≤1024 字符，模型据此判断何时用此 skill）</Label>
        <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="代码评审最佳实践…" />
      </div>
      <div>
        <Label>SKILL.md 正文（markdown）</Label>
        <Textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={10} placeholder="# 技能说明&#10;## 步骤&#10;## 检查清单" />
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button onClick={onDone} variant="ghost">取消</Button>
        <Button variant="primary" onClick={save}>保存</Button>
      </div>
    </div>
  );
}

// ---------- Skill 池 ----------
function SkillSection() {
  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SkillDef | undefined>();

  async function refresh() {
    setSkills(await api.get<SkillDef[]>("/skills"));
  }
  useEffect(() => { void refresh(); }, []);

  async function remove(name: string) {
    if (!confirm(`确定删除 skill ${name}？`)) return;
    await api.del(`/skills/${name}`);
    void refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Skill 池：可被 Agent 勾选启用，运行时会注入其 SKILL.md 正文</p>
        <Button variant="primary" onClick={() => { setEditing(undefined); setShowForm(true); }} className="px-3 py-1.5 text-sm">
          + 新建 Skill
        </Button>
      </div>

      {skills.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted">Skill 池为空，点击右上角新建</Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {skills.map((s) => (
          <Card key={s.name} className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <BookOpen className="h-4 w-4" />
                </div>
                <span className="font-semibold text-fg">{s.name}</span>
              </div>
              <div className="flex gap-1">
                <button onClick={() => { setEditing(s); setShowForm(true); }} className="rounded-md p-1.5 text-muted hover:bg-muted/10 hover:text-fg" title="编辑">
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => remove(s.name)} className="rounded-md p-1.5 text-muted hover:bg-destructive/10 hover:text-destructive" title="删除">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <p className="mt-2 line-clamp-2 text-xs text-muted">{s.description}</p>
            <div className="mt-2 text-[10px] text-muted">
              {s.body.length} 字符 · {s.hasReferences ? "有 references" : "无 references"}
            </div>
          </Card>
        ))}
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? "编辑 Skill" : "新建 Skill"} wide>
        <SkillForm
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

// ---------- 开机自启（Windows 原生） ----------
function AutoLaunchToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    void (window as any).desktop?.isAutoLaunch().then(setOn).catch(() => {});
  }, []);
  return (
    <label className="flex items-center gap-2 text-sm text-fg">
      <input
        type="checkbox"
        checked={on}
        onChange={async (e) => {
          const v = await (window as any).desktop?.setAutoLaunch(e.target.checked);
          setOn(!!v);
        }}
      />
      开机自启
    </label>
  );
}

// ---------- 系统信息（Windows 原生） ----------
function SystemInfo() {
  const [info, setInfo] = useState<Record<string, any> | null>(null);
  useEffect(() => {
    void (window as any).desktop?.systemInfo().then(setInfo).catch(() => {});
  }, []);
  if (!info) return <span className="text-xs text-muted">加载中…</span>;
  const uptimeMin = Math.round((Number(info.uptime) || 0) / 60);
  return (
    <div className="space-y-1 text-xs text-muted">
      <div>平台：{String(info.platform)} · {String(info.arch)}</div>
      <div>Electron {String(info.versions?.electron)} · Node {String(info.versions?.node)}</div>
      <div>运行时长：{uptimeMin > 0 ? `${uptimeMin} 分钟` : "刚刚启动"}</div>
    </div>
  );
}

// ---------- 本地 Agent 发现与同步 ----------
function DiscoverySection() {
  const [agents, setAgents] = useState<DetectedAgent[]>([]);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);

  async function refresh() {
    setAgents(await api.get<DetectedAgent[]>("/discovery"));
  }
  useEffect(() => { void refresh(); }, []);

  async function sync(type: string) {
    setSyncing(type);
    setResult(null);
    try {
      setResult(await api.post(`/discovery/${type}/sync`));
      void refresh();
    } finally {
      setSyncing(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">自动识别本机安装的 agent（Claude Code / Hermes），可同步其技能、记忆与配置到平台</p>

      {agents.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted">未检测到本地 agent</Card>
      )}

      {agents.map((a) => (
        <Card key={a.type} className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Download className="h-5 w-5" />
              </div>
              <div>
                <div className="font-semibold text-fg">{a.name}</div>
                <div className="text-xs text-muted">
                  {a.type} {a.version ? `· ${a.version}` : ""} · {a.skills.length} 技能 · {a.memoryCount} 条记忆
                </div>
              </div>
            </div>
            <Button variant="primary" onClick={() => sync(a.type)} disabled={syncing === a.type} className="px-3 py-1.5 text-xs">
              {syncing === a.type ? "同步中…" : "同步"}
            </Button>
          </div>
          {a.skills.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {a.skills.map((s) => (
                <Badge key={s.name} color="brand">{s.name}</Badge>
              ))}
            </div>
          )}
        </Card>
      ))}

      {result && (
        <Card className="p-4 text-sm">
          <div className="text-success">
            ✓ 导入 {result.importedSkills.length} 个技能 · {result.importedMemory} 条记忆
            {result.createdAgent ? ` · 创建 agent「${result.createdAgent}」` : ""}
          </div>
          {result.errors.length > 0 && (
            <div className="mt-1 text-xs text-destructive">{result.errors.join("；")}</div>
          )}
        </Card>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState<"providers" | "tools" | "mcp" | "skills" | "local" | "relay" | "general">("providers");
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ProviderConfig | undefined>();
  const [fetchingModels, setFetchingModels] = useState<string | null>(null);

  // 中继服务器状态
  const [relayUrl, setRelayUrl] = useState("http://47.92.39.184:8888");
  const [relayStatus, setRelayStatus] = useState<{ connected: boolean; status: string }>({ connected: false, status: "disconnected" });
  const [relayConnecting, setRelayConnecting] = useState(false);

  async function refresh() {
    const [p, s] = await Promise.all([api.get<ProviderConfig[]>("/providers"), api.get<AppSettings>("/settings")]);
    setProviders(p ?? []);
    setSettings(s);

    // 获取中继状态
    try {
      const relay = await api.get<{ connected: boolean; status: string }>("/relay/status");
      if (relay) setRelayStatus(relay);
    } catch (e) {
      // 忽略错误
    }
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

  async function connectRelay() {
    if (!relayUrl.trim()) return;
    setRelayConnecting(true);
    try {
      const result = await api.post<{ success: boolean; message?: string; error?: string }>("/relay/connect", { url: relayUrl });
      if (result?.success) {
        alert("✅ " + result.message);
      } else {
        alert("❌ " + (result?.error || "连接失败"));
      }
      void refresh();
    } catch (e) {
      alert("❌ 连接失败: " + (e as Error).message);
    } finally {
      setRelayConnecting(false);
    }
  }

  async function disconnectRelay() {
    await api.post("/relay/disconnect");
    void refresh();
  }

  const tabs = [
    { key: "providers" as const, label: "LLM Providers", icon: <Plug className="h-4 w-4" /> },
    { key: "tools" as const, label: "工具与安全", icon: <Wrench className="h-4 w-4" /> },
    { key: "mcp" as const, label: "MCP", icon: <Server className="h-4 w-4" /> },
    { key: "skills" as const, label: "Skill 池", icon: <BookOpen className="h-4 w-4" /> },
    { key: "local" as const, label: "本地 Agent", icon: <Download className="h-4 w-4" /> },
    { key: "relay" as const, label: "云端中继", icon: <Cloud className="h-4 w-4" /> },
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
              <Input value={settings.workspaceRoot} onBlur={(e) => saveSettings({ workspaceRoot: e.target.value })} placeholder="留空则无文件访问" />
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

          <Card className="p-5">
            <h3 className="mb-1 text-sm font-semibold text-fg">安全围栏</h3>
            <p className="mb-3 text-xs text-muted">约束 Agent 的工具执行边界（命令 / 文件 / 网络）</p>
            <div className="mb-3 grid grid-cols-3 gap-3">
              <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={settings.security?.allowNetwork ?? true}
                  onChange={(e) => saveSettings({ security: { ...settings.security, allowNetwork: e.target.checked } })}
                />
                允许联网
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={settings.security?.allowFileRead ?? true}
                  onChange={(e) => saveSettings({ security: { ...settings.security, allowFileRead: e.target.checked } })}
                />
                允许读文件
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={settings.security?.allowFileWrite ?? true}
                  onChange={(e) => saveSettings({ security: { ...settings.security, allowFileWrite: e.target.checked } })}
                />
                允许写文件
              </label>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <Label>命令白名单（前缀匹配，留空=全允许，空格分隔）</Label>
                <Input
                  value={(settings.security?.allowedCommands ?? []).join(" ")}
                  onBlur={(e) =>
                    saveSettings({ security: { ...settings.security, allowedCommands: e.target.value.split(/\s+/).filter(Boolean) } })
                  }
                  placeholder="npm git node python"
                />
              </div>
              <div>
                <Label>命令黑名单（子串匹配，空格分隔）</Label>
                <Input
                  value={(settings.security?.blockedCommands ?? []).join(" ")}
                  onBlur={(e) =>
                    saveSettings({ security: { ...settings.security, blockedCommands: e.target.value.split(/\s+/).filter(Boolean) } })
                  }
                  placeholder="rm -rf format shutdown"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={settings.security?.allowDangerousCommands ?? false}
                onChange={(e) => saveSettings({ security: { ...settings.security, allowDangerousCommands: e.target.checked } })}
              />
              允许危险命令（rm -rf / format / shutdown 等，默认禁止）
            </label>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-fg">外部记忆（Mem0）</h3>
                <p className="mt-0.5 text-xs text-muted">可选：连接 Mem0 服务获得语义/向量记忆（增强跨任务检索）</p>
              </div>
              <label className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={!!settings.mem0?.enabled}
                  onChange={(e) => saveSettings({ mem0: { endpoint: settings.mem0?.endpoint ?? "", apiKey: settings.mem0?.apiKey, enabled: e.target.checked } })}
                />
                启用
              </label>
            </div>
            {settings.mem0?.enabled && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <Label>Endpoint</Label>
                  <Input value={settings.mem0.endpoint} onChange={(e) => saveSettings({ mem0: { endpoint: e.target.value, apiKey: settings.mem0?.apiKey, enabled: true } })} placeholder="https://api.mem0.ai" />
                </div>
                <div>
                  <Label>API Key</Label>
                  <Input type="password" value={settings.mem0.apiKey ?? ""} onChange={(e) => saveSettings({ mem0: { endpoint: settings.mem0?.endpoint ?? "", apiKey: e.target.value, enabled: true } })} placeholder="m0-…" />
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "mcp" && <McpSection />}

      {tab === "skills" && <SkillSection />}

      {tab === "local" && <DiscoverySection />}

      {tab === "relay" && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-fg">云端中继服务器</h3>
                <p className="mt-0.5 text-xs text-muted">支持手机端跨网络连接，无需同一 WiFi</p>
              </div>
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${relayStatus.connected ? "bg-emerald-500" : "bg-gray-400"}`} />
                <span className="text-xs text-muted">
                  {relayStatus.connected ? "已连接" : "未连接"}
                </span>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <Label>服务器地址</Label>
                <Input
                  value={relayUrl}
                  onChange={(e) => setRelayUrl(e.target.value)}
                  placeholder="http://your-server:8888"
                />
              </div>

              <div className="flex gap-2">
                {relayStatus.connected ? (
                  <Button variant="secondary" onClick={disconnectRelay} className="px-4 py-2">
                    断开连接
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    onClick={connectRelay}
                    disabled={relayConnecting || !relayUrl.trim()}
                    className="px-4 py-2"
                  >
                    {relayConnecting ? <Spinner label="连接中" /> : "连接中继服务器"}
                  </Button>
                )}
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-2 text-sm font-semibold text-fg">使用说明</h3>
            <div className="space-y-2 text-xs text-muted">
              <p>📡 <strong>局域网直连</strong>：手机和电脑在同一 WiFi 下，自动发现并连接</p>
              <p>☁️ <strong>云端中继</strong>：手机和电脑不在同一网络，通过中继服务器连接</p>
              <p className="mt-3">
                <strong>部署中继服务器：</strong>
              </p>
              <pre className="mt-1 rounded bg-muted/20 p-2 text-[11px]">
{`# 1. 上传代码到服务器
scp -r relay-server/ root@your-server:/opt/ensemble/

# 2. 安装依赖并启动
ssh root@your-server
cd /opt/ensemble/relay-server
npm install --production
npm install -g pm2
PORT=8888 pm2 start dist/index.js --name ensemble-relay
pm2 save && pm2 startup`}
              </pre>
            </div>
          </Card>
        </div>
      )}

      {tab === "general" && (
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="mb-1 text-sm font-semibold text-fg">配置目录</h3>
            <p className="mb-3 text-xs text-muted">Agent 配置、Provider 配置、数据库等存储位置</p>
            {(window as any).desktop?.openConfigDir ? (
              <Button variant="secondary" onClick={() => (window as any).desktop.openConfigDir()}>打开配置目录</Button>
            ) : (
              <span className="text-xs text-muted">（浏览器模式下不可用）</span>
            )}
          </Card>

          {(window as any).desktop?.isAutoLaunch && (
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-fg">开机自启</h3>
                  <p className="mt-0.5 text-xs text-muted">Windows 登录时自动启动合鸣</p>
                </div>
                <AutoLaunchToggle />
              </div>
            </Card>
          )}

          {(window as any).desktop?.systemInfo && (
            <Card className="p-5">
              <h3 className="mb-2 text-sm font-semibold text-fg">系统信息</h3>
              <SystemInfo />
            </Card>
          )}
        </div>
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
