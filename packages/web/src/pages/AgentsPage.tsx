import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Agent, ProviderConfig } from "../types";
import {
  Badge, Button, Card, EmptyState, Input, Label, Modal, Select, Spinner, Textarea,
} from "../components/ui";

function AgentForm({ initial, onDone }: { initial?: Agent; onDone: () => void }) {
  const [form, setForm] = useState<Agent>(
    () =>
      initial ?? ({
        id: "",
        name: "",
        kind: "builtin",
        description: "",
        providerId: "",
        model: "",
        systemPrompt: "",
        temperature: 0.7,
        maxIterations: 10,
        tools: [],
        capabilities: { sessionResume: true, partialStreaming: true, toolUseEvents: false, concurrent: true, cwdConfigurable: true },
        enabled: true,
      } as Agent),
  );
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [allTools, setAllTools] = useState<string[]>([]);
  const [customModel, setCustomModel] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);

  const set = (patch: Partial<Agent>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    void (async () => {
      const [p, h] = await Promise.all([api.get<ProviderConfig[]>("/providers"), api.get<any>("/health")]);
      setProviders(p ?? []);
      setAllTools(h?.tools ?? []);
      if (!initial) {
        const enabled = (p ?? []).find((x) => x.enabled);
        if (enabled) set({ providerId: enabled.id, model: enabled.defaultModel ?? "" });
      }
    })();
  }, []);

  useEffect(() => {
    if (!form.providerId) {
      setModels([]);
      return;
    }
    setLoadingModels(true);
    api
      .get<{ models: string[] }>(`/providers/${form.providerId}/models`)
      .then((d) => setModels(d?.models ?? []))
      .catch(() => setModels([]))
      .finally(() => setLoadingModels(false));
  }, [form.providerId]);

  function toggleTool(name: string) {
    set({ tools: form.tools.includes(name) ? form.tools.filter((t) => t !== name) : [...form.tools, name] });
  }

  const activeModel = customModel || form.model;

  async function save() {
    if (!form.id.trim() || !form.name.trim()) return;
    const body = { ...form, model: activeModel };
    if (initial) {
      await api.put(`/agents/${initial.id}`, body);
    } else {
      await api.post("/agents", body);
    }
    onDone();
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>ID</Label>
          <Input value={form.id} onChange={(e) => set({ id: e.target.value })} placeholder="researcher" disabled={!!initial} />
        </div>
        <div>
          <Label>显示名</Label>
          <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="调研员" />
        </div>
      </div>

      <div>
        <Label>LLM Provider</Label>
        <Select value={form.providerId} onChange={(e) => set({ providerId: e.target.value })}>
          <option value="">-- 选择 provider（先到设置页配置）--</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}（{p.type}）
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label>模型</Label>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Select
            value={customModel ? "__custom" : form.model}
            onChange={(e) => {
              if (e.target.value === "__custom") {
                set({ model: "" });
              } else {
                setCustomModel("");
                set({ model: e.target.value });
              }
            }}
            disabled={loadingModels || !form.providerId}
          >
            {loadingModels && <option>加载模型中…</option>}
            {!loadingModels && models.length === 0 && <option value="">（拉取模型失败，可手输）</option>}
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value="__custom">✏️ 自定义模型名…</option>
          </Select>
          <Input
            className="w-48"
            placeholder="自定义模型名"
            value={customModel}
            onChange={(e) => {
              setCustomModel(e.target.value);
              set({ model: e.target.value });
            }}
          />
        </div>
      </div>

      <div>
        <Label>角色 / System Prompt</Label>
        <Textarea value={form.systemPrompt ?? ""} onChange={(e) => set({ systemPrompt: e.target.value })} rows={3} placeholder="定义这个 agent 的角色、行为、输出风格…" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Temperature（0-2）</Label>
          <Input type="number" step="0.1" min={0} max={2} value={form.temperature ?? 0.7} onChange={(e) => set({ temperature: Number(e.target.value) })} />
        </div>
        <div>
          <Label>最大迭代次数</Label>
          <Input type="number" min={1} max={50} value={form.maxIterations ?? 10} onChange={(e) => set({ maxIterations: Number(e.target.value) })} />
        </div>
      </div>

      <div>
        <Label>启用的工具</Label>
        <div className="flex flex-wrap gap-2">
          {allTools.length === 0 ? (
            <span className="text-xs text-ink-400">无可选工具</span>
          ) : (
            allTools.map((name) => (
              <button
                key={name}
                onClick={() => toggleTool(name)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  form.tools.includes(name)
                    ? "border-brand-500 bg-brand-50 font-medium text-brand-700"
                    : "border-ink-200 text-ink-600 hover:border-brand-300"
                }`}
              >
                {name}
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-ink-100 pt-4">
        <label className="flex items-center gap-2 text-sm text-ink-600">
          <input type="checkbox" checked={!!form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          启用
        </label>
        <Button onClick={onDone} variant="ghost">取消</Button>
        <Button variant="primary" onClick={save} disabled={!form.id.trim() || !form.name.trim()}>保存</Button>
      </div>
    </div>
  );
}

function TestButton({ agent }: { agent: Agent }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function test() {
    setBusy(true);
    setResult(null);
    try {
      const data = await api.post<{ events: any[] }>(`/agents/${agent.id}/test`, { prompt: "Reply with exactly: OK" });
      const done = data.events.find((e) => e.type === "done");
      setResult(done ? `${done.outcome} · ${(done.result ?? "").slice(0, 60)}` : "no done event");
    } catch (e) {
      setResult(`error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button onClick={test} disabled={busy} variant="secondary" className="px-2.5 py-1.5 text-xs">
        {busy ? "测试中…" : "冒烟测试"}
      </Button>
      {result && <span className="max-w-[220px] truncate text-xs text-ink-500">{result}</span>}
    </div>
  );
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Agent | undefined>();

  async function refresh() {
    setAgents(await api.get<Agent[]>("/agents"));
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function remove(id: string) {
    if (!confirm(`确定删除 agent ${id}？`)) return;
    await api.del(`/agents/${id}`);
    void refresh();
  }

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Agents</h1>
          <p className="mt-1 text-sm text-ink-500">在应用内创建自定义 Agent（选择模型、配置角色与工具）</p>
        </div>
        <Button variant="primary" onClick={() => { setEditing(undefined); setShowForm(true); }}>
          + 新建 Agent
        </Button>
      </header>

      {loading ? (
        <Spinner label="加载中" />
      ) : agents.length === 0 ? (
        <Card>
          <EmptyState icon="🤖" title="还没有 Agent" desc="点击右上角创建第一个自定义 Agent" />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {agents.map((a) => (
            <Card key={a.id} className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-100 to-brand-200 text-lg">
                    ⚡
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink-900">{a.name}</span>
                      <Badge color={a.enabled ? "green" : "ink"}>{a.enabled ? "启用" : "停用"}</Badge>
                    </div>
                    <div className="text-xs text-ink-400">{a.id}</div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { setEditing(a); setShowForm(true); }} className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700" title="编辑">✏️</button>
                  <button onClick={() => remove(a.id)} className="rounded-md p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-500" title="删除">🗑️</button>
                </div>
              </div>

              {a.description && <p className="mt-3 text-sm text-ink-500">{a.description}</p>}

              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge color="brand">{a.model || "未配置模型"}</Badge>
                {a.providerId && <Badge color="violet">{a.providerId}</Badge>}
                {a.tools.length > 0 && <Badge color="amber">{a.tools.length} 工具</Badge>}
              </div>

              {!a.providerId && (
                <div className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                  未配置 provider，运行前请先到 设置 添加
                </div>
              )}

              <div className="mt-4 border-t border-ink-100 pt-3">
                <TestButton agent={a} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? "编辑 Agent" : "新建 Agent"} wide>
        <AgentForm
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
