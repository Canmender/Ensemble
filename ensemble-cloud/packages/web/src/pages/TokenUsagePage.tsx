import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Zap } from "lucide-react";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../lib/api";
import { Card, EmptyState, Spinner } from "../components/ui";

interface TokenStats {
  total: { input: number; output: number };
  byDay: Array<{ day: string; input: number; output: number }>;
  byAgent: Array<{ agentId: string; agentName: string; input: number; output: number }>;
  runCount: number;
}

const PIE_COLORS = [
  "#6366f1", "#22c55e", "#f59e0b", "#ef4444",
  "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16",
];

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function TokenUsagePage() {
  const [stats, setStats] = useState<TokenStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setStats(await api.get<TokenStats>("/tokens/stats"));
      } catch (e) {
        console.error("加载 Token 用量失败:", e);
        setError("加载 Token 用量失败：" + (e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const pieData = useMemo(
    () =>
      (stats?.byAgent ?? []).map((a) => ({
        name: a.agentName,
        value: a.input + a.output,
      })),
    [stats],
  );

  const grandTotal = (stats ? stats.total.input + stats.total.output : 0);

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
          <Zap className="h-6 w-6 text-primary" /> Token用量
        </h1>
        <p className="mt-1 text-sm text-muted">各 Agent 的 LLM 调用消耗（按任务记录聚合）</p>
      </header>

      {loading ? (
        <Spinner label="加载中" />
      ) : error ? (
        <Card>
          <EmptyState icon={<Zap className="h-8 w-8" />} title="加载失败" desc={error} />
        </Card>
      ) : !stats || grandTotal === 0 ? (
        <Card>
          <EmptyState
            icon={<Zap className="h-8 w-8" />}
            title="还没有用量数据"
            desc="运行一次 Agent 任务后，这里会展示 Token 消耗图表"
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {/* 汇总卡片 */}
          <div className="grid grid-cols-3 gap-4">
            <Card className="p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted">
                <ArrowDownToLine className="h-3.5 w-3.5" /> 输入 tokens
              </div>
              <div className="mt-1 text-xl font-bold text-fg">{stats.total.input.toLocaleString()}</div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted">
                <ArrowUpFromLine className="h-3.5 w-3.5" /> 输出 tokens
              </div>
              <div className="mt-1 text-xl font-bold text-fg">{stats.total.output.toLocaleString()}</div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted">
                <Zap className="h-3.5 w-3.5" /> 总计
              </div>
              <div className="mt-1 text-xl font-bold text-primary">{grandTotal.toLocaleString()}</div>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* 饼图：按 agent 占比 */}
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold text-fg">按 Agent 占比</h2>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={95}
                    paddingAngle={2}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any) => fmt(Number(v))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </Card>

            {/* 折线图：按日趋势 */}
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold text-fg">按日趋势</h2>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={stats.byDay} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--c-border))" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: any) => fmt(Number(v))} />
                  <Tooltip formatter={(v: any) => Number(v).toLocaleString()} />
                  <Legend />
                  <Line type="monotone" dataKey="input" name="输入" stroke="#6366f1" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="output" name="输出" stroke="#22c55e" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {/* 明细表 */}
          <Card>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Agent</th>
                  <th className="px-4 py-2.5 text-right font-medium">输入</th>
                  <th className="px-4 py-2.5 text-right font-medium">输出</th>
                  <th className="px-4 py-2.5 text-right font-medium">合计</th>
                </tr>
              </thead>
              <tbody>
                {stats.byAgent.map((a) => (
                  <tr key={a.agentId} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5 text-fg">{a.agentName}</td>
                    <td className="px-4 py-2.5 text-right text-muted">{a.input.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-muted">{a.output.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-fg">
                      {(a.input + a.output).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
