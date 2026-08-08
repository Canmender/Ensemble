import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api } from "./lib/api";
import { wsClient } from "./lib/ws";
import { cls } from "./components/ui";
import DashboardPage from "./pages/DashboardPage";
import AgentsPage from "./pages/AgentsPage";
import TasksPage from "./pages/TasksPage";
import RunPage from "./pages/RunPage";
import SettingsPage from "./pages/SettingsPage";

function NavItem({ to, label, icon }: { to: string; label: string; icon: string }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cls(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isActive ? "bg-brand-50 text-brand-700" : "text-ink-500 hover:bg-ink-100 hover:text-ink-800",
        )
      }
    >
      <span className="text-base leading-none">{icon}</span>
      {label}
    </NavLink>
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
      <aside className="flex w-56 flex-col border-r border-ink-200 bg-white">
        <div className="flex items-center gap-2 px-4 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white">
            ⚡
          </div>
          <div>
            <div className="text-sm font-bold text-ink-900">MultiAgent</div>
            <div className="text-[10px] text-ink-400">多 Agent 协作平台</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          <NavItem to="/" label="概览" icon="📊" />
          <NavItem to="/agents" label="Agents" icon="🤖" />
          <NavItem to="/tasks" label="任务" icon="📋" />
          <NavItem to="/settings" label="设置" icon="⚙️" />
        </nav>
        <div className="border-t border-ink-100 px-4 py-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-400">后端</span>
            <span className="flex items-center gap-1.5">
              <span
                className={cls(
                  "h-2 w-2 rounded-full",
                  serverOk === null ? "bg-ink-300" : serverOk ? "bg-emerald-500" : "bg-red-500",
                )}
              />
              <span className="font-medium text-ink-600">
                {serverOk === null ? "检测中" : serverOk ? `${agentCount} agents` : "离线"}
              </span>
            </span>
          </div>
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
        </Routes>
      </main>
    </div>
  );
}
