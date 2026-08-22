import { useCallback, useEffect, useState } from "react";
import { Bot, Brain, Pencil, Trash2, Zap } from "lucide-react";
import { api } from "../lib/api";
import type { Agent, DetectedAgent, LocalAgentConfig, MemorySnapshot, ProviderConfig, SkillDef } from "../types";
import {
  Badge, Button, Card, EmptyState, Input, Label, Modal, Select, Spinner, Textarea, cls, showToast,
} from "../components/ui";
import { useConfirm } from "../hooks/useConfirm";

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
        skills: [],
        local: { command: "", promptMode: "arg" },
        memory: { enabled: false },
        context: {},
        capabilities: { sessionResume: true, partialStreaming: true, toolUseEvents: false, concurrent: true, cwdConfigurable: true },
        enabled: true,
      } as Agent),
  );
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [allTools, setAllTools] = useState<string[]>([]);
  const [allSkills, setAllSkills] = useState<SkillDef[]>([]);
  const [customModel, setCustomModel] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [detectedHarnesses, setDetectedHarnesses] = useState<DetectedAgent[]>([]);

  const set = (patch: Partial<Agent>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    void (async () => {
      const [p, h, sk, disc] = await Promise.all([
        api.get<ProviderConfig[]>("/providers"),
        api.get<{ tools: string[] }>("/health"),
        api.get<SkillDef[]>("/skills").catch(() => []),
        api.get<DetectedAgent[]>("/discovery").catch(() => []),
      ]);
      setProviders(p ?? []);
      setAllTools(h?.tools ?? []);
      setAllSkills(sk ?? []);
      setDetectedHarnesses(disc ?? []);
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

  const patchLocal = (patch: Partial<LocalAgentConfig>) =>
    set({ local: { ...(form.local ?? { command: "" }), ...patch } });

  function toggleSkill(name: string) {
    const cur = form.skills ?? [];
    set({ skills: cur.includes(name) ? cur.filter((s) => s !== name) : [...cur, name] });
  }

  const activeModel = customModel || form.model;

  async function save() {
    if (!form.id.trim() || !form.name.trim()) return;
    try {
      // builtin 不带 local（避免空 command 触发 schema 校验 / 残留死配置）
      const body = { ...form, model: activeModel, local: form.kind === "local" ? form.local : undefined };
      if (initial) {
        await api.put(`/agents/${initial.id}`, body);
      } else {
        await api.post("/agents", body);
      }
      onDone();
    } catch (e) {
      console.error("保存 Agent 失败:", e);
      showToast("保存 Agent 失败: " + (e as Error).message, "error");
    }
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
        <Label>类型</Label>
        <Select value={form.kind} onChange={(e) => set({ kind: e.target.value as Agent["kind"] })}>
          <option value="builtin">内置（LLM + 工具循环）</option>
          <option value="local">本地命令 Agent（接入已有 agent CLI）</option>
        </Select>
      </div>

      {form.kind === "builtin" ? (
        <>
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
            <option value="__custom">自定义模型名…</option>
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
            <span className="text-xs text-muted">无可选工具</span>
          ) : (
            allTools.map((name) => (
              <button
                key={name}
                onClick={() => toggleTool(name)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  form.tools.includes(name)
                    ? "border-primary bg-primary/10 font-medium text-primary"
                    : "border-border text-muted hover:border-primary/50"
                }`}
              >
                {name}
              </button>
            ))
          )}
        </div>
      </div>

      {/* 启用的 Skills */}
      <div>
        <Label>启用的 Skill（运行时注入其 SKILL.md 到上下文）</Label>
        {allSkills.length === 0 ? (
          <span className="text-xs text-muted">Skill 池为空，到 设置 → Skill 池 添加</span>
        ) : (
          <div className="grid gap-1.5">
            {allSkills.map((s) => (
              <button
                key={s.name}
                onClick={() => toggleSkill(s.name)}
                className={cls(
                  "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                  (form.skills ?? []).includes(s.name)
                    ? "border-primary bg-primary/10"
                    : "border-border text-muted hover:border-primary/50",
                )}
              >
                <span className={cls("font-medium", (form.skills ?? []).includes(s.name) ? "text-primary" : "text-fg")}>{s.name}</span>
                <span className="truncate text-xs text-muted">{s.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 记忆 + 上下文配置 */}
      <div className="rounded-lg border border-border p-3">
        <label className="flex items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={!!form.memory?.enabled}
            onChange={(e) => set({ memory: { ...form.memory, enabled: e.target.checked } })}
          />
          <span className="font-medium">启用长期记忆</span>
          <span className="text-xs text-muted">Agent 跨任务积累记忆（需 LLM 做记忆提取，消耗少量 token）</span>
        </label>
        {form.memory?.enabled && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <Label>注入上限（字符）</Label>
              <Input type="number" value={form.memory.injectMaxChars ?? 3000} onChange={(e) => set({ memory: { ...form.memory, injectMaxChars: Number(e.target.value) } })} />
            </div>
            <div>
              <Label>记忆模型（留空用 Agent 模型）</Label>
              <Input value={form.memory.model ?? ""} onChange={(e) => set({ memory: { ...form.memory, model: e.target.value } })} placeholder="可指定廉价模型" />
            </div>
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <Label>上下文压缩阈值（0-1）</Label>
            <Input
              type="number" step="0.1" min={0} max={1}
              value={form.context?.compactionThreshold ?? 0.5}
              onChange={(e) => set({ context: { ...form.context, compactionThreshold: Number(e.target.value) } })}
            />
          </div>
          <div>
            <Label>上下文预算（tokens）</Label>
            <Input
              type="number"
              value={form.context?.budgetTokens ?? 80000}
              onChange={(e) => set({ context: { ...form.context, budgetTokens: Number(e.target.value) } })}
            />
          </div>
        </div>
      </div>
      </>
      ) : (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div>
            <Label>选择本地 harness 作为母本（自动识别已安装）</Label>
            {detectedHarnesses.length === 0 ? (
              <span className="text-xs text-muted">未检测到本地 agent harness</span>
            ) : (
              <div className="flex flex-wrap gap-2">
                {detectedHarnesses.map((h) => (
                  <button
                    key={h.type}
                    onClick={() => patchLocal({ command: h.headless, promptMode: h.promptMode })}
                    title={`${h.headless}${h.skills.length ? ` · ${h.skills.length} 技能` : ""}${h.memoryCount ? ` · ${h.memoryCount} 记忆` : ""}`}
                    className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                      form.local?.command === h.headless
                        ? "border-primary bg-primary/10 font-medium text-primary"
                        : "border-border text-muted hover:border-primary/50"
                    }`}
                  >
                    {h.name}
                    {h.version ? ` · ${h.version.slice(0, 20)}` : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <Label>命令（本地 agent CLI / 脚本）</Label>
            <Input
              value={form.local?.command ?? ""}
              onChange={(e) => patchLocal({ command: e.target.value })}
              placeholder="claude -p / hermes -z / python agent.py …"
            />
          </div>
          <div>
            <Label>额外参数（空格分隔）</Label>
            <Input
              value={(form.local?.args ?? []).join(" ")}
              onChange={(e) =>
                patchLocal({ args: e.target.value.split(/\s+/).filter(Boolean) })
              }
              placeholder="--model sonnet --verbose"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Prompt 传递</Label>
              <Select
                value={form.local?.promptMode ?? "arg"}
                onChange={(e) => patchLocal({ promptMode: e.target.value as LocalAgentConfig["promptMode"] })}
              >
                <option value="arg">作为最后参数</option>
                <option value="stdin">写入 stdin</option>
              </Select>
            </div>
            <div>
              <Label>超时（秒）</Label>
              <Input
                type="number"
                value={(form.local?.timeoutMs ?? 120) / 1000}
                onChange={(e) => patchLocal({ timeoutMs: Number(e.target.value) * 1000 })}
              />
            </div>
          </div>
          <p className="text-xs text-muted">通过子进程调用本地命令，prompt 传给 agent，捕获 stdout 作为结果。适合接入已有的 agent CLI。</p>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
        <label className="flex items-center gap-2 text-sm text-muted">
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
      const data = await api.post<{ events: Array<{ type: string; outcome?: string; result?: string }> }>(`/agents/${agent.id}/test`, { prompt: "Reply with exactly: OK" });
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
      {result && <span className="max-w-[220px] truncate text-xs text-muted">{result}</span>}
    </div>
  );
}

// ---------- 记忆查看 ----------
function MemoryModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [snap, setSnap] = useState<MemorySnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setSnap(await api.get<MemorySnapshot>(`/agents/${agent.id}/memory`));
  }
  useEffect(() => { void refresh(); }, []);

  async function consolidate() {
    setBusy(true);
    try {
      await api.post(`/agents/${agent.id}/memory/consolidate`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`记忆 · ${agent.name}`} wide>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">
            {snap ? `${snap.dailyLogs.length} 天日志 · flush ${snap.stats.flushCount} 次` : "加载中…"}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={consolidate} disabled={busy}>
              {busy ? "整理中…" : "立即整理"}
            </Button>
            <Button variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={onClose}>关闭</Button>
          </div>
        </div>

        {snap?.memoryFile ? (
          <div>
            <div className="mb-1 text-xs font-semibold text-muted">长期记忆 MEMORY.md</div>
            <pre className="max-h-56 overflow-y-auto rounded-lg bg-bg p-3 font-mono text-xs leading-relaxed text-fg">
              {snap.memoryFile.content}
            </pre>
          </div>
        ) : (
          <div className="rounded-lg bg-bg p-3 text-xs text-muted">
            还没有长期记忆。启用"长期记忆"并运行任务后，Agent 会在这里积累跨任务记忆。
          </div>
        )}

        {snap && snap.dailyLogs.length > 0 && (
          <details className="text-xs text-muted">
            <summary className="cursor-pointer hover:text-fg">日常日志（{snap.dailyLogs.length} 天）</summary>
            <ul className="mt-2 space-y-1">
              {snap.dailyLogs.slice(0, 7).map((d) => (
                <li key={d.date} className="flex justify-between rounded bg-bg px-2 py-1">
                  <span className="font-mono">{d.date}</span>
                  <span>{d.lineCount} 行 · {Math.round(d.sizeBytes / 1024 * 10) / 10} KB</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Modal>
  );
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Agent | undefined>();
  const [memoryAgent, setMemoryAgent] = useState<Agent | null>(null);
  const { confirm, Dialog } = useConfirm();

  async function refresh() {
    setAgents(await api.get<Agent[]>("/agents"));
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function remove(id: string) {
    const ok = await confirm({ title: "删除 Agent", message: `确定删除 agent ${id}？`, confirmLabel: "删除", danger: true });
    if (!ok) return;
    await api.del(`/agents/${id}`);
    void refresh();
  }

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-fg">Agents</h1>
          <p className="mt-1 text-sm text-muted">在应用内创建自定义 Agent（选择模型、配置角色与工具）</p>
        </div>
        <Button variant="primary" onClick={() => { setEditing(undefined); setShowForm(true); }} aria-label="添加 Agent">
          + 新建 Agent
        </Button>
      </header>

      {loading ? (
        <Spinner label="加载中" />
      ) : agents.length === 0 ? (
        <Card>
          <EmptyState icon={<Bot className="h-8 w-8" />} title="还没有 Agent" desc="点击右上角创建第一个自定义 Agent" />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {agents.map((a) => (
            <Card key={a.id} className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/25 text-primary">
                    <Zap className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-fg">{a.name}</span>
                      <Badge color={a.enabled ? "green" : "ink"}>{a.enabled ? "启用" : "停用"}</Badge>
                    </div>
                    <div className="text-xs text-muted">{a.id}</div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { setEditing(a); setShowForm(true); }} className="rounded-md p-1.5 text-muted hover:bg-muted/10 hover:text-fg" aria-label="编辑" title="编辑">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => remove(a.id)} className="rounded-md p-1.5 text-muted hover:bg-destructive/10 hover:text-destructive" aria-label="删除" title="删除">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {a.description && <p className="mt-3 text-sm text-muted">{a.description}</p>}

              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge color="brand">{a.model || "未配置模型"}</Badge>
                {a.providerId && <Badge color="violet">{a.providerId}</Badge>}
                {a.tools.length > 0 && <Badge color="amber">{a.tools.length} 工具</Badge>}
              </div>

              {!a.providerId && (
                <div className="mt-2 rounded-md bg-warning/10 px-2 py-1 text-[11px] text-warning">
                  未配置 provider，运行前请先到 设置 添加
                </div>
              )}

              <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                <TestButton agent={a} />
                <button
                  onClick={() => setMemoryAgent(a)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-muted/10 hover:text-fg"
                  title="查看记忆"
                >
                  <Brain className="h-3.5 w-3.5" />
                  {a.memory?.enabled ? "记忆" : "记忆(关)"}
                </button>
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

      {memoryAgent && <MemoryModal agent={memoryAgent} onClose={() => setMemoryAgent(null)} />}
      {Dialog}
    </div>
  );
}
