/**
 * 审计页：查询「我批准/拒绝了哪些工具动作」。
 *
 * 数据来自 GET /api/audit（服务端强制按当前登录用户过滤，本轮不开放跨用户查询）。
 * 页面**只读**，不提供任何修改或删除入口——审计数据一旦可被编辑，
 * 它就不再是可信的证据链。保留期清理由服务端脚本负责。
 */
import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { Card, EmptyState, Spinner, Button, cls } from "../components/ui";

interface AuditEntry {
  id: string;
  ts: string;
  action: string;
  runId?: string;
  tool?: string;
  argsDigest?: string;
  decision: "approve" | "reject" | "auto_reject";
  reason?: "timeout" | "shutdown";
  /** 本轮恒为 null：风险评分在 web 端算、服务端拿不到（docs/AUDIT-DESIGN.md §4.1） */
  risk?: string | null;
  latencyMs?: number;
  confirmId?: string;
}

const DECISION_META: Record<AuditEntry["decision"], { label: string; cls: string }> = {
  approve: { label: "已批准", cls: "bg-success/15 text-success" },
  reject: { label: "已拒绝", cls: "bg-destructive/15 text-destructive" },
  auto_reject: { label: "自动拒绝", cls: "bg-warning/15 text-warning" },
};

const REASON_LABEL: Record<string, string> = { timeout: "超时未响应", shutdown: "应用关闭" };

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"" | AuditEntry["decision"]>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = filter ? `?decision=${filter}` : "";
      setEntries(await api.get<AuditEntry[]>(`/audit${q}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
            <ShieldCheck className="h-6 w-6 text-primary" /> 审计
          </h1>
          <p className="mt-1 text-sm text-muted">
            你批准或拒绝过的工具动作。只记录元数据，不含消息内容与参数原文。
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()}>
          <RefreshCw className="mr-1.5 h-4 w-4" /> 刷新
        </Button>
      </header>

      <div className="mb-4 flex gap-2">
        {(["", "approve", "reject", "auto_reject"] as const).map((d) => (
          <button
            key={d || "all"}
            onClick={() => setFilter(d)}
            className={cls(
              "rounded-full px-3 py-1 text-xs transition-colors",
              filter === d ? "bg-primary text-primary-fg" : "bg-muted/40 text-muted hover:text-fg",
            )}
          >
            {d ? DECISION_META[d].label : "全部"}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner label="加载中" />
      ) : error ? (
        <Card><EmptyState icon={<ShieldCheck className="h-8 w-8" />} title="加载失败" desc={error} /></Card>
      ) : entries.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShieldCheck className="h-8 w-8" />}
            title="暂无审计记录"
            desc="当 Agent 请求执行敏感工具、需要你确认时，决定会记录在这里"
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => {
            const meta = DECISION_META[e.decision];
            return (
              <Card key={e.id} className="flex items-start gap-3 px-4 py-3">
                <span className={cls("mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", meta.cls)}>
                  {meta.label}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-fg">{e.tool || e.action}</span>
                    {e.reason && (
                      <span className="shrink-0 text-[10px] text-muted">
                        （{REASON_LABEL[e.reason] ?? e.reason}）
                      </span>
                    )}
                  </div>
                  {e.argsDigest && (
                    <div className="mt-0.5 truncate font-mono text-[10px] text-muted" title={e.argsDigest}>
                      {e.argsDigest}
                    </div>
                  )}
                  <div className="mt-0.5 text-[10px] text-muted">
                    {new Date(e.ts).toLocaleString("zh-CN")}
                    {typeof e.latencyMs === "number" && ` · 耗时 ${e.latencyMs}ms`}
                    {e.runId && ` · run ${e.runId}`}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}