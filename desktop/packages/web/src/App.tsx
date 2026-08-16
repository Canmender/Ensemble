import { Suspense, lazy, useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Bot, Brain, LayoutDashboard, MessageSquare, Moon, Settings, Sun,
  Workflow, Zap, MonitorSmartphone, Archive, LogOut, User as UserIcon
} from "lucide-react";
import { api } from "./lib/api";
import { wsClient } from "./lib/ws";
import { useTheme, type Theme } from "./lib/theme";
import { useAuth } from "./lib/auth";
import { useMode } from "./lib/mode";
import { cls } from "./components/ui";
import { Avatar } from "./components/Avatar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CallOverlay } from "./components/CallOverlay";
import { bootstrapCallService } from "./lib/callService";

/* 路由级懒加载：首屏只加载当前页面，其余按需拆分 */
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const AgentsPage = lazy(() => import("./pages/AgentsPage"));
const TasksPage = lazy(() => import("./pages/TasksPage"));
const RunPage = lazy(() => import("./pages/RunPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const MemoryPage = lazy(() => import("./pages/MemoryPage"));
const WorkflowsPage = lazy(() => import("./pages/WorkflowsPage"));
const ChatPage = lazy(() => import("./pages/ChatPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const ModeLandingPage = lazy(() => import("./pages/ModeLandingPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));

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
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
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
      className="relative flex h-6 w-11 items-center rounded-full bg-muted/30 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      title={isDark ? "切换到浅色" : "切换到深色"}
      aria-label={isDark ? "切换到浅色主题" : "切换到深色主题"}
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
        "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        isSystem ? "bg-primary/10 text-primary" : "text-muted hover:bg-muted/10 hover:text-fg",
      )}
      title={isSystem ? "已跟随系统主题" : "点击跟随系统主题"}
      aria-label={isSystem ? "已跟随系统主题" : "点击跟随系统主题"}
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
  const { state, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [agentCount, setAgentCount] = useState(0);

  useEffect(() => {
    wsClient.connect();
    bootstrapCallService();
    const check = () =>
      api
        .get("/health")
        .then((d: any) => {
          setServerOk(true);
          setAgentCount(d.agents ?? 0);
        })
        .catch(() => setServerOk(false));
    check();
    const t = setInterval(check, 10000);
    return () => clearInterval(t);
  }, []);

  // 多端协作模式：确保中继已连接（使用已保存配置），手机方可经中继访问本机
  useEffect(() => {
    if (mode !== "multi" || state.status !== "authenticated") return;
    let cancelled = false;
    (async () => {
      try {
        const relay = await api.get<{ connected: boolean }>("/relay/status");
        if (!relay?.connected && !cancelled) {
          await api.post("/relay/connect", {});
        }
      } catch {
        /* 忽略（连接失败不阻断） */
      }
    })();
    return () => { cancelled = true; };
  }, [state.status]);

  const authPaths = ["/login", "/register"];
  const onAuthPage = authPaths.includes(location.pathname);

  // 首启/未选模式：进入模式选择页
  const mode = useMode();
  if (!mode) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<PageLoading />}>
          <ModeLandingPage />
        </Suspense>
      </ErrorBoundary>
    );
  }

  // 登录态判定中
  if (state.status === "loading") return <PageLoading />;

  // 未登录（服务器模式）：仅允许登录/注册页
  if (state.status === "guest") {
    if (!onAuthPage) return <Navigate to="/login" replace />;
    return (
      <ErrorBoundary>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    );
  }

  // 已登录 / 本地模式：访问登录页 → 回首页
  if (onAuthPage) return <Navigate to="/" replace />;

  const isUser = state.status === "authenticated";
  const displayName = isUser ? (state.user?.displayName ?? state.user?.username ?? "用户") : (mode === "multi" ? "多端协作" : "本地模式");
  const userAvatar = isUser ? state.user?.avatarUrl : undefined;

  return (
    <div className="flex h-full">
      <CallOverlay />
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-border bg-surface">
        <div className="px-4 py-5">
        <button
          onClick={() => navigate("/profile")}
          className="flex w-full items-center gap-2.5 rounded-lg p-1 text-left transition-colors hover:bg-muted/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          title="个人主页"
        >
          <Avatar name={displayName} avatarUrl={userAvatar} size={38} />
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-fg">{displayName}</div>
            <div className="truncate text-[10px] text-muted">{mode === "multi" ? "@云端 · 多端协作" : "本地模式"}</div>
          </div>
        </button>
      </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>
        <div className="space-y-2 border-t border-border px-3 py-3">
          {/* 用户信息 */}
          <div className="flex items-center justify-between px-1">
            <span className="flex items-center gap-1.5 text-xs font-medium text-fg/80">
              <UserIcon className="h-3.5 w-3.5" />
              {isUser ? state.user?.displayName ?? state.user?.username : (mode === "multi" ? "多端协作" : "本地模式")}
            </span>
            <div className="flex items-center gap-1">
              {isUser && (
                <button
                  onClick={logout}
                  className="text-muted transition-colors hover:text-fg"
                  title="退出登录"
                  aria-label="退出登录"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              )}
              <NavLink
                to="/settings"
                className="text-muted transition-colors hover:text-fg"
                title={mode === "multi" ? "多端协作（设置中可切换本地/多端）" : "本地模式（设置中可切换本地/多端）"}
              >
                <Settings className="h-3.5 w-3.5" />
              </NavLink>
            </div>
          </div>
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
        <ErrorBoundary>
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
              <Route path="/profile" element={<ProfilePage />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}