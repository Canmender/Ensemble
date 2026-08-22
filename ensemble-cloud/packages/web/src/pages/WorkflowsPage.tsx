/**
 * 协作画布页面 —— 可视化展示智能体协作流程
 *
 * 参考 coze/n8n/Flowise 设计：
 * - 节点 = 智能体任务，显示状态、工具调用、输出摘要
 * - 连线 = 数据流/依赖关系，带动画
 * - 实时更新节点状态
 */

import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { Node, Edge } from "@xyflow/react";
import { Bot, ChevronDown, Workflow, Pause, Clock, CheckCircle2, XCircle, Wrench, Brain, MessageSquare } from "lucide-react";
import { api } from "../lib/api";
import { wsClient } from "../lib/ws";
import { useRunStore, type AgentEventItem, type LiveJob } from "../store/runs";
import { relativeTime } from "../lib/events";
import { loadRunDetail } from "../lib/loadRunDetail";
import type { Run } from "../types";
import { Card, Spinner, StatusDot, cls, statusLabel } from "../components/ui";

/** @xyflow/react 动态加载：~140KB，仅在需要时加载 */
interface CanvasNode extends Node<AgentNodeData & Record<string, unknown>> {}

interface CanvasEdge extends Edge {}

const CanvasView = lazy(() =>
  Promise.all([
    import("@xyflow/react"),
    // @ts-ignore
    import("@xyflow/react/dist/style.css"),
  ]).then(([rf]) => ({
    default: function CanvasViewInner({ nodes, edges, nodeTypes }: { nodes: CanvasNode[]; edges: CanvasEdge[]; nodeTypes: Record<string, any> }) {
      const { ReactFlow, Background, Controls } = rf;
      return (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{
            type: "smoothstep",
            style: { strokeWidth: 1.5 },
          }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      );
    },
  })),
);

/** 状态颜色映射 */
const STATUS_COLORS: Record<string, string> = {
  queued: "#94a3b8",
  running: "#3b82f6",
  thinking: "#8b5cf6",
  success: "#22c55e",
  error: "#ef4444",
  cancelled: "#f59e0b",
};

const STATUS_BG: Record<string, string> = {
  queued: "bg-slate-500/10",
  running: "bg-blue-500/10",
  thinking: "bg-violet-500/10",
  success: "bg-green-500/10",
  error: "bg-red-500/10",
  cancelled: "bg-amber-500/10",
};

const STATUS_BORDER: Record<string, string> = {
  queued: "border-slate-400/50",
  running: "border-blue-500",
  thinking: "border-violet-500",
  success: "border-green-500",
  error: "border-red-500",
  cancelled: "border-amber-500",
};

/** 状态图标 */
function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "running":
    case "thinking":
      return <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />;
    case "success":
      return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
    case "error":
      return <XCircle className="h-3.5 w-3.5 text-destructive" />;
    case "cancelled":
      return <Pause className="h-3.5 w-3.5 text-warning" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-muted" />;
  }
}

/** 工具调用摘要 */
function ToolCallsSummary({ events }: { events: AgentEventItem[] }) {
  const toolCalls = events.filter(e => e.event?.type === "tool_use");
  if (toolCalls.length === 0) return null;

  const tools: Record<string, number> = {};
  for (const e of toolCalls) {
    const name = e.event?.tool || "unknown";
    tools[name] = (tools[name] || 0) + 1;
  }

  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {Object.entries(tools).slice(0, 3).map(([name, count]) => (
        <span key={name} className="flex items-center gap-0.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
          <Wrench className="h-2.5 w-2.5" />
          {name}{count > 1 ? ` ×${count}` : ""}
        </span>
      ))}
      {Object.keys(tools).length > 3 && (
        <span className="text-[10px] text-muted">+{Object.keys(tools).length - 3}</span>
      )}
    </div>
  );
}

/** 节点详情面板 */
function NodeDetails({ job, events }: { job: LiveJob; events: AgentEventItem[] }) {
  const toolCalls = events.filter(e => e.event?.type === "tool_use");
  const outputs = events.filter(e => e.event?.type === "output");
  const lastOutput = outputs.length > 0 ? outputs[outputs.length - 1] : null;

  return (
    <div className="border-t border-border px-3 py-2.5 space-y-2">
      {/* Prompt */}
      {job.prompt && (
        <div>
          <div className="text-[10px] font-semibold uppercase text-muted mb-1">Prompt</div>
          <div className="max-h-[100px] overflow-y-auto rounded bg-bg/50 p-2 text-[11px] font-mono text-fg">
            {job.prompt.slice(0, 300)}{job.prompt.length > 300 ? "..." : ""}
          </div>
        </div>
      )}

      {/* 工具调用详情 */}
      {toolCalls.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase text-muted mb-1">工具调用</div>
          <div className="space-y-1 max-h-[150px] overflow-y-auto">
            {toolCalls.slice(-5).map((e, i) => (
              <div key={i} className="flex items-start gap-1.5 rounded bg-amber-500/5 p-1.5">
                <Wrench className="h-3 w-3 mt-0.5 text-amber-500 shrink-0" />
                <div className="min-w-0">
                  <span className="text-[11px] font-medium text-fg">{e.event?.tool}</span>
                  <span className="text-[10px] text-muted ml-1.5">{JSON.stringify(e.event?.input ?? {}).slice(0, 80)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 输出结果 */}
      {lastOutput && (
        <div>
          <div className="text-[10px] font-semibold uppercase text-muted mb-1">最新输出</div>
          <div className="max-h-[120px] overflow-y-auto rounded bg-primary/5 p-2 text-[11px] text-fg">
            {lastOutput.event?.text?.slice(0, 500)}
          </div>
        </div>
      )}

      {/* 最终结果 */}
      {job.result && job.status === "success" && (
        <div>
          <div className="text-[10px] font-semibold uppercase text-muted mb-1">结果</div>
          <div className="max-h-[150px] overflow-y-auto rounded bg-success/5 p-2 text-[11px] text-fg">
            {job.result.slice(0, 500)}{job.result.length > 500 ? "..." : ""}
          </div>
        </div>
      )}
    </div>
  );
}

/** 自定义节点组件 */
interface AgentNodeData {
  job: LiveJob;
  events: AgentEventItem[];
  isExpanded: boolean;
  onToggle: () => void;
}

function AgentNode({ data }: { data: AgentNodeData }) {
  const { job, events, isExpanded, onToggle } = data;
  const status = job.status || "queued";

  return (
    <div
      className={cls(
        "min-w-[220px] max-w-[320px] rounded-xl border-2 bg-surface shadow-lg transition-all",
        STATUS_BORDER[status],
        status === "running" || status === "thinking" ? "shadow-primary/20" : "",
      )}
    >
      {/* 节点头部 */}
      <div
        className={cls(
          "flex items-center gap-2 rounded-t-[10px] px-3 py-2.5 cursor-pointer",
          STATUS_BG[status],
        )}
        onClick={onToggle}
      >
        <div className={cls(
          "flex h-8 w-8 items-center justify-center rounded-lg",
          status === "success" ? "bg-success/20 text-success" :
          status === "error" ? "bg-destructive/20 text-destructive" :
          status === "running" || status === "thinking" ? "bg-primary/20 text-primary" :
          "bg-muted/20 text-muted",
        )}>
          <Bot className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-fg truncate">{job.agentName || job.agentId}</div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <StatusIcon status={status} />
            <span className={cls(
              status === "success" ? "text-success" :
              status === "error" ? "text-destructive" :
              status === "running" || status === "thinking" ? "text-primary" :
              "text-muted",
            )}>
              {statusLabel(status)}
            </span>
          </div>
        </div>
        <ChevronDown className={cls("h-4 w-4 text-muted transition-transform", isExpanded && "rotate-180")} />
      </div>

      {/* 工具调用摘要 */}
      <div className="px-3 pb-2">
        <ToolCallsSummary events={events} />
      </div>

      {/* 展开详情 */}
      {isExpanded && <NodeDetails job={job} events={events} />}
    </div>
  );
}

/** 协作画布 */
function CollaborationCanvas({ runId }: { runId: string }) {
  const live = useRunStore((s) => s.live[runId]);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const nodeTypes = useMemo(() => ({ agent: AgentNode }), []);

  const jobs = useMemo(() => Object.values(live?.jobs ?? {}), [live?.jobs]);
  const events = useMemo(() => (live?.events ?? []).slice().sort((a, b) => a.seq - b.seq), [live?.events]);

  // 按执行顺序排列 jobs
  const orderedJobs = useMemo(() => {
    const order = [...new Set(events.map((e) => e.jobId).filter(Boolean))] as string[];
    const byId = Object.fromEntries(jobs.map((j) => [j.id, j]));
    return [
      ...order.map((id) => byId[id]).filter(Boolean),
      ...jobs.filter((j) => !order.includes(j.id)),
    ];
  }, [jobs, events]);

  // 构建节点
  const nodes = useMemo(() => {
    const nodeWidth = 260;
    const gapX = 80;
    const gapY = 40;

    return orderedJobs.map((job, i) => {
      const jobEvents = events.filter((e) => e.jobId === job.id);
      const col = i % 3;
      const row = Math.floor(i / 3);

      return {
        id: job.id,
        type: "agent",
        position: {
          x: col * (nodeWidth + gapX) + 50,
          y: row * 160 + 50,
        },
        data: {
          job,
          events: jobEvents,
          isExpanded: !!expandedNodes[job.id],
          onToggle: () => {
            setExpandedNodes((prev) => ({
              ...prev,
              [job.id]: !prev[job.id],
            }));
          },
        },
        style: { padding: 0, width: nodeWidth },
      };
    });
  }, [orderedJobs, events, expandedNodes]);

  // 构建连线（按执行顺序）
  const edges = useMemo(() => {
    const result: CanvasEdge[] = [];
    for (let i = 1; i < orderedJobs.length; i++) {
      const prev = orderedJobs[i - 1];
      const curr = orderedJobs[i];
      const isActive = prev.status === "running" || curr.status === "running";

      result.push({
        id: `e-${prev.id}-${curr.id}`,
        source: prev.id,
        target: curr.id,
        animated: isActive,
        style: {
          stroke: isActive ? STATUS_COLORS.running : STATUS_COLORS.queued,
          strokeWidth: isActive ? 2 : 1.5,
        },
      });
    }
    return result;
  }, [orderedJobs]);

  if (orderedJobs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <div className="text-center">
          <Brain className="mx-auto h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm">等待智能体开始工作...</p>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><Spinner label="加载画布…" /></div>}>
      <CanvasView nodes={nodes} edges={edges} nodeTypes={nodeTypes} />
    </Suspense>
  );
}

/** 运行卡片 */
function RunCard({ run, isExpanded, onToggle }: { run: Run; isExpanded: boolean; onToggle: () => void }) {
  const live = useRunStore((s) => s.live[run.id]);
  const status = live?.status ?? run.status;
  const jobs = useMemo(() => Object.values(live?.jobs ?? {}), [live?.jobs]);

  return (
    <Card className={cls("overflow-hidden transition-all", isExpanded ? "col-span-full" : "")}>
      <button onClick={onToggle} aria-expanded={isExpanded} className="flex w-full items-center gap-3 p-4 text-left">
        <StatusDot status={status} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-fg">{run.taskTitle || "未命名工作流"}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-muted">{relativeTime(run.startedAt)}</span>
            {jobs.length > 0 && (
              <span className="text-[10px] text-muted">
                · {jobs.filter(j => j.status === "success").length}/{jobs.length} 完成
              </span>
            )}
          </div>
        </div>
        <span className={cls(
          "text-xs font-medium",
          status === "success" ? "text-success" :
          status === "error" ? "text-destructive" :
          status === "running" ? "text-primary" :
          "text-muted",
        )}>
          {statusLabel(status)}
        </span>
        <ChevronDown className={cls("h-4 w-4 text-muted transition-transform", isExpanded && "rotate-180")} />
      </button>

      {/* 展开时显示画布 */}
      {isExpanded && (
        <div className="h-[500px] border-t border-border">
          <CollaborationCanvas runId={run.id} />
        </div>
      )}
    </Card>
  );
}

export default function WorkflowsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "running" | "workflow" | "chat">("all");

  async function refresh() {
    const allRuns = await api.get<Run[]>("/runs").catch(() => []);
    // 自动展示所有任务，包括 workflow 和 chat 模式
    setRuns(allRuns);
  }

  useEffect(() => {
    wsClient.subscribe("*");
    void refresh();
    const t = setInterval(refresh, 3000);
    return () => {
      wsClient.unsubscribe("*");
      clearInterval(t);
    };
  }, []);

  async function toggle(id: string) {
    const newExpanded = expanded === id ? null : id;
    setExpanded(newExpanded);
    if (newExpanded) {
      await loadRunDetail(id, { loadEvents: true, loadChatMessages: false });
    }
  }

  // 过滤显示的运行
  const filteredRuns = useMemo(() => {
    switch (filter) {
      case "running":
        return runs.filter(r => r.status === "running" || r.status === "queued");
      case "workflow":
        return runs.filter(r => r.mode === "workflow");
      case "chat":
        return runs.filter(r => r.mode === "chat");
      default:
        return runs;
    }
  }, [runs, filter]);

  // 统计
  const stats = useMemo(() => ({
    total: runs.length,
    running: runs.filter(r => r.status === "running" || r.status === "queued").length,
    workflow: runs.filter(r => r.mode === "workflow").length,
    chat: runs.filter(r => r.mode === "chat").length,
  }), [runs]);

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
          <Workflow className="h-6 w-6 text-primary" /> 协作画布
        </h1>
        <p className="mt-1 text-sm text-muted">可视化查看智能体协作流程：节点状态、工具调用、数据流</p>
      </header>

      {/* 统计卡片 */}
      <div className="mb-6 grid grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted">全部任务</div>
          <div className="mt-1 text-2xl font-bold text-fg">{stats.total}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1 text-xs text-muted">
            <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            执行中
          </div>
          <div className="mt-1 text-2xl font-bold text-primary">{stats.running}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1 text-xs text-muted">
            <Workflow className="h-3 w-3" />
            工作流
          </div>
          <div className="mt-1 text-2xl font-bold text-violet-500">{stats.workflow}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1 text-xs text-muted">
            <MessageSquare className="h-3 w-3" />
            群聊
          </div>
          <div className="mt-1 text-2xl font-bold text-amber-500">{stats.chat}</div>
        </Card>
      </div>

      {/* 过滤标签 */}
      <div className="mb-4 flex items-center gap-2">
        {[
          { key: "all" as const, label: "全部", count: stats.total },
          { key: "running" as const, label: "执行中", count: stats.running },
          { key: "workflow" as const, label: "工作流", count: stats.workflow },
          { key: "chat" as const, label: "群聊", count: stats.chat },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={cls(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
              filter === tab.key
                ? "bg-primary text-primary-fg"
                : "bg-muted/10 text-muted hover:bg-muted/20 hover:text-fg",
            )}
          >
            {tab.label}
            <span className={cls(
              "rounded-full px-1.5 py-0.5 text-[10px]",
              filter === tab.key ? "bg-primary-fg/20" : "bg-muted/20",
            )}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* 运行列表 */}
      {filteredRuns.length === 0 ? (
        <Card className="p-8 text-center">
          <Workflow className="mx-auto h-12 w-12 text-muted/30 mb-3" />
          <p className="text-sm text-muted">
            {filter === "all" ? "还没有任务" :
             filter === "running" ? "没有正在执行的任务" :
             filter === "workflow" ? "没有工作流任务" :
             "没有群聊任务"}
          </p>
          <p className="text-xs text-muted/70 mt-1">到"看板"页创建新任务</p>
        </Card>
      ) : (
        <div className={cls("grid gap-4", expanded ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3")}>
          {filteredRuns.map((r) => (
            <RunCard
              key={r.id}
              run={r}
              isExpanded={expanded === r.id}
              onToggle={() => void toggle(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
