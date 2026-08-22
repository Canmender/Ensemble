import { useEffect, useState } from "react";
import { Brain, Database, FileText } from "lucide-react";
import { api } from "../lib/api";
import { Badge, Card, EmptyState, Spinner } from "../components/ui";

interface MemoryEntryLike {
  id: string;
  agentId: string;
  content: string;
  createdAt: string;
}

interface AgentMemory {
  agentId: string;
  name: string;
  memory?: string;
  dailyCount: number;
  sqlCount: number;
  sqlEntries?: MemoryEntryLike[];
  stats: { flushCount: number; consolidateCount: number; memUsageTokens?: number };
}

export default function MemoryPage() {
  const [list, setList] = useState<AgentMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setList(await api.get<AgentMemory[]>("/memory"));
        setError(null);
      } catch (e) {
        console.error("加载记忆失败:", e);
        setError("加载记忆数据失败：" + (e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
          <Brain className="h-6 w-6 text-primary" /> 记忆
        </h1>
        <p className="mt-1 text-sm text-muted">所有 Agent 的长期记忆（文件 MEMORY.md + 本地 SQL 条目）</p>
      </header>

      {loading ? (
        <Spinner label="加载中" />
      ) : error ? (
        <Card>
          <EmptyState
            icon={<Brain className="h-8 w-8" />}
            title="加载失败"
            desc={error}
          />
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Brain className="h-8 w-8" />}
            title="还没有记忆"
            desc="在 Agent 上开启'长期记忆'并运行任务后，这里会积累跨任务记忆"
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {list.map((a) => (
            <Card key={a.agentId} className="p-5">
              <button
                onClick={() => setExpanded(expanded === a.agentId ? null : a.agentId)}
                className="flex w-full items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Brain className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold text-fg">{a.name}</div>
                    <div className="text-xs text-muted">{a.agentId}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Badge color="brand"><FileText className="mr-1 h-3 w-3" /> {a.dailyCount} 天日志</Badge>
                  <Badge color="violet"><Database className="mr-1 h-3 w-3" /> {a.sqlCount} SQL</Badge>
                  <span className="text-muted">
                    flush {a.stats.flushCount} · consolidate {a.stats.consolidateCount}
                    {a.stats.memUsageTokens ? ` · ${a.stats.memUsageTokens} tokens` : ""}
                  </span>
                </div>
              </button>

              {expanded === a.agentId && (
                <div className="mt-4 space-y-3 border-t border-border pt-4">
                  {a.memory && (
                    <div>
                      <div className="mb-1 text-xs font-semibold text-muted">长期记忆 MEMORY.md</div>
                      <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-bg p-3 text-xs leading-relaxed text-fg">
                        {a.memory}
                      </pre>
                    </div>
                  )}
                  {a.sqlEntries && a.sqlEntries.length > 0 && (
                    <div>
                      <div className="mb-1 text-xs font-semibold text-muted">SQL 记忆条目（{a.sqlEntries.length}）</div>
                      <div className="space-y-1">
                        {a.sqlEntries.map((e) => (
                          <div key={e.id} className="rounded-lg bg-bg px-3 py-2 text-xs text-fg">
                            {e.content.slice(0, 300)}
                            <div className="mt-0.5 text-[10px] text-muted">{new Date(e.createdAt).toLocaleString("zh-CN")}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {!a.memory && (!a.sqlEntries || a.sqlEntries.length === 0) && (
                    <div className="text-xs text-muted">该 agent 暂无详细记忆内容</div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
