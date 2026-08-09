import { Suspense, lazy, useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import {
  Bot, Brain, LayoutDashboard, MessageSquare, Moon, Settings, Sun,
  Workflow, Zap, MonitorSmartphone, Archive
} from "lucide-react";
import { api } from "./lib/api";
import { wsClient } from "./lib/ws";
import { useTheme, type Theme } from "./lib/theme";
import { cls } from "./components/ui";

/* 路由级懒加载：首屏只加载当前页面，其余按需拆分 */
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const AgentsPage = lazy(() => import("./pages/AgentsPage"));
const TasksPage = lazy(() => import("./pages/TasksPage"));
const RunPage = lazy(() => import("./pages/RunPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const MemoryPage = lazy(() => import("./pages/MemoryPage"));
const WorkflowsPage = lazy(() => import("./pages/WorkflowsPage"));
const ChatPage = lazy(() => import("./pages/ChatPage"));

const NAV_ITEMS = [
  { to: "/", label: "看板", icon: LayoutDashboard },
  { to: "/agents", label: "智能体", icon: Bot },
  { to: "/workflows", label: "工作流", icon: Workflow },
  { to: "/tasks", label: "归档处", icon: Archive },
  { to: "/chat", label: "群聊", icon: MessageSquare },
  { to: "/memory", label: "记忆", icon: Brain },
  { to: "/settings", label: "设置", icon: Settings },
];

function NavItem({ to, label, icon: Icon }: { to: string; label: string; icon: typeof Zap }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cls(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isActive ? "bg-primary/10 text-primary" : "text-muted hover:bg-muted/10 hover:text-fg",
        )
      }
    >
      <Icon className="h-4 w-4" />
      {label}
    </NavLink>
  );
}

/** 亮暗色切换开关 */
function ThemeSwitch() {
  const { isDark, setTheme } = useTheme();
  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="relative flex h-6 w-11 items-center rounded-full bg-muted/30 transition-colors hover:bg-muted/50"
      title={isDark ? "切换到浅色" : "切换到深色"}
    >
      <span
        className={cls(
          "flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform",
          isDark ? "translate-x-5" : "translate-x-0.5",
        )}
      >
        {isDark ? <Moon className="h-3 w-3 text-primary" /> : <Sun className="h-3 w-3 text-amber-500" />}
      </span>
    </button>
  );
}

/** 跟随系统按钮 */
function SystemThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isSystem = theme === "system";
  return (
    <button
      onClick={() => setTheme(isSystem ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : "system")}
      className={cls(
        "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-colors",
        isSystem ? "bg-primary/10 text-primary" : "text-muted hover:bg-muted/10 hover:text-fg",
      )}
      title={isSystem ? "已跟随系统主题" : "点击跟随系统主题"}
    >
      <MonitorSmartphone className="h-3.5 w-3.5" />
      <span>跟随系统</span>
    </button>
  );
}

/** 页面加载骨架屏 */
function PageLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-sm">加载中…</span>
      </div>
    </div>
  );
}

export default function App() {
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [agentCount, setAgentCount] = useState(0);

  useEffect(() => {
    wsClient.connect();
    void api
      .get("/health")
      .then((d: any) => {
        setServerOk(true);
        setAgentCount(d.agents?.length ?? 0);
      })
      .catch(() => setServerOk(false));
    const t = setInterval(() => {
      api
        .get("/health")
        .then((d: any) => {
          setServerOk(true);
          setAgentCount(d.agents?.length ?? 0);
        })
        .catch(() => setServerOk(false));
    }, 10000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-border bg-surface">
        <div className="flex items-center gap-2.5 px-4 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent text-primary-fg shadow-sm">
            <Zap className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-bold text-fg">合鸣</div>
            <div className="text-[10px] text-muted">多 Agent 协作平台</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>
        <div className="space-y-2 border-t border-border px-3 py-3">
          {/* 服务器状态 */}
          <div className="flex items-center justify-between px-1">
            <span className="flex items-center gap-1.5 text-xs">
              <span
                className={cls(
                  "h-2 w-2 rounded-full",
                  serverOk === null ? "bg-muted/50" : serverOk ? "bg-success" : "bg-destructive",
                )}
              />
              <span className="font-medium text-muted">
                {serverOk === null ? "检测中" : serverOk ? `${agentCount} agents` : "离线"}
              </span>
            </span>
          </div>
          {/* 主题控制 */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-muted">主题</span>
            <div className="flex items-center gap-2">
              <ThemeSwitch />
              <SystemThemeToggle />
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/runs/:id" element={<RunPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/memory" element={<MemoryPage />} />
            <Route path="/workflows" element={<WorkflowsPage />} />
            <Route path="/chat" element={<ChatPage />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
