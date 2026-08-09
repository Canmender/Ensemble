/**
 * 归档处页面
 * 负责统计和调用已完成的任务
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Archive, BarChart3, Calendar, CheckCircle, Clock, Search, TrendingUp } from "lucide-react";
import { api } from "../lib/api";
import { relativeTime } from "../lib/events";
import type { Run } from "../types";
import { Badge, Card, EmptyState, Input, Spinner, cls } from "../components/ui";

/** 统计卡片 */
function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number | string; color: string }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${color}`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div>
        <div className="text-2xl font-bold text-fg">{value}</div>
        <div className="text-xs text-muted">{label}</div>
      </div>
    </Card>
  );
}

export default function TasksPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "success" | "error" | "cancelled">("all");

  useEffect(() => {
    void loadRuns();
  }, []);

  async function loadRuns() {
    setLoading(true);
    try {
      const data = await api.get<Run[]>("/runs");
      setRuns(data ?? []);
    } finally {
      setLoading(false);
    }
  }

  // 统计数据
  const stats = {
    total: runs.length,
    success: runs.filter((r) => r.status === "success").length,
    error: runs.filter((r) => r.status === "error").length,
    cancelled: runs.filter((r) => r.status === "cancelled").length,
  };

  // 过滤
  const filtered = runs.filter((r) => {
    if (filter !== "all" && r.status !== filter) return false;
    if (search && !r.taskTitle?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // 按日期分组
  const grouped = filtered.reduce<Record<string, Run[]>>((acc, run) => {
    const date = new Date(run.startedAt).toLocaleDateString("zh-CN");
    if (!acc[date]) acc[date] = [];
    acc[date].push(run);
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-fg">归档处</h1>
        <p className="mt-1 text-sm text-muted">查看历史任务统计和已完成的任务</p>
      </header>

      {/* 统计卡片 */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        <StatCard icon={BarChart3} label="总任务数" value={stats.total} color="bg-blue-500" />
        <StatCard icon={CheckCircle} label="成功" value={stats.success} color="bg-emerald-500" />
        <StatCard icon={Clock} label="失败" value={stats.error} color="bg-red-500" />
        <StatCard icon={TrendingUp} label="取消" value={stats.cancelled} color="bg-gray-500" />
      </div>

      {/* 搜索和过滤 */}
      <div className="mb-6 flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索任务..."
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          {(["all", "success", "error", "cancelled"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cls(
                "rounded-lg px-3 py-1.5 text-sm transition-colors",
                filter === f ? "bg-primary/10 text-primary" : "text-muted hover:bg-muted/10",
              )}
            >
              {f === "all" ? "全部" : f === "success" ? "成功" : f === "error" ? "失败" : "取消"}
            </button>
          ))}
        </div>
      </div>

      {/* 任务列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner label="加载中" />
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <EmptyState icon={<Archive className="h-8 w-8" />} title="暂无归档" desc="还没有已完成的任务" />
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([date, dateRuns]) => (
            <div key={date}>
              <div className="mb-3 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted" />
                <span className="text-sm font-medium text-muted">{date}</span>
                <span className="text-xs text-muted">({dateRuns.length} 个任务)</span>
              </div>
              <div className="space-y-2">
                {dateRuns.map((run) => (
                  <Link
                    key={run.id}
                    to={`/runs/${run.id}`}
                    className="group flex items-center justify-between rounded-xl border border-border bg-surface p-4 transition-all hover:border-primary/50 hover:shadow-sm"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cls(
                          "h-2.5 w-2.5 rounded-full",
                          run.status === "success" ? "bg-success" : run.status === "error" ? "bg-destructive" : "bg-muted",
                        )}
                      />
                      <div>
                        <div className="font-medium text-fg group-hover:text-primary">{run.taskTitle || "未命名任务"}</div>
                        <div className="mt-0.5 text-xs text-muted">{run.mode} · {relativeTime(run.startedAt)}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge color={run.status === "success" ? "green" : run.status === "error" ? "red" : "ink"}>
                        {run.status === "success" ? "成功" : run.status === "error" ? "失败" : run.status}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
