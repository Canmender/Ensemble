import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { Bot, Brain, LayoutDashboard, ListTodo, MessageSquare, Moon, Settings, Sun, Workflow, Zap } from "lucide-react";
import { api } from "./lib/api";
import { wsClient } from "./lib/ws";
import { useTheme, type Theme } from "./lib/theme";
import { cls } from "./components/ui";
import DashboardPage from "./pages/DashboardPage";
import AgentsPage from "./pages/AgentsPage";
import TasksPage from "./pages/TasksPage";
import RunPage from "./pages/RunPage";
import SettingsPage from "./pages/SettingsPage";
import MemoryPage from "./pages/MemoryPage";
import WorkflowsPage from "./pages/WorkflowsPage";
import ChatPage from "./pages/ChatPage";

const NAV_ITEMS = [
  { to: "/", label: "概览", icon: LayoutDashboard },
  { to: "/agents", label: "Agents", icon: Bot },
  { to: "/workflows", label: "工作流", icon: Workflow },
  { to: "/tasks", label: "任务", icon: ListTodo },
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

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const cycling: Theme[] = ["light", "dark", "system"];
  const next = cycling[(cycling.indexOf(theme) + 1) % cycling.length];
  const labels: Record<Theme, string> = { light: "浅色", dark: "深色", system: "跟随系统" };
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Zap;
  return (
    <button
      onClick={() => setTheme(next)}
      title={`主题：${labels[theme]}（点击切换到${labels[next]}）`}
      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-muted transition-colors hover:bg-muted/10 hover:text-fg"
    >
      <Icon className="h-4 w-4" />
      <span className="text-xs">{labels[theme]}</span>
    </button>
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
        <div className="space-y-1 border-t border-border px-3 py-3">
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
          <ThemeToggle />
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
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
      </main>
    </div>
  );
}
