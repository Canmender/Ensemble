import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Monitor, Cloud, ChevronRight, Zap } from "lucide-react";
import { setMode } from "../lib/mode";
import { api } from "../lib/api";
import { Button } from "../components/ui";

/** 首启模式选择页：本地模式 / 多端协作 */
export default function ModeLandingPage() {
  const navigate = useNavigate();
  const [picking, setPicking] = useState<"local" | "multi" | null>(null);

  async function chooseLocal() {
    setPicking("local");
    setMode("local");
    // 本地模式：离线使用，无需登录
    navigate("/", { replace: true });
  }

  async function chooseMulti() {
    setPicking("multi");
    setMode("multi");
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-xl space-y-8">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent shadow-lg">
            <Zap className="h-8 w-8 text-primary-fg" />
          </div>
          <h1 className="text-2xl font-bold text-fg">欢迎使用合鸣</h1>
          <p className="mt-2 text-sm text-fg/60">多 Agent 协作平台 · 选择运行模式开始</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* 本地模式 */}
          <button
            onClick={chooseLocal}
            disabled={picking === "local"}
            className="group rounded-2xl border border-border bg-surface p-6 text-left transition-all hover:border-primary/50 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Monitor className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold text-fg">本地模式</h2>
            <p className="mt-1 text-sm text-fg/60">单机离线使用，数据保留在本机，无需登录。</p>
            {picking === "local" ? (
              <span className="mt-4 inline-block text-sm text-primary">进入中…</span>
            ) : (
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                使用 <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            )}
          </button>

          {/* 多端协作 */}
          <button
            onClick={chooseMulti}
            disabled={picking === "multi"}
            className="group rounded-2xl border border-border bg-surface p-6 text-left transition-all hover:border-accent/50 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <Cloud className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold text-fg">多端协作</h2>
            <p className="mt-1 text-sm text-fg/60">登录云端账号，连接中继服务器，手机可远程操控本机执行任务。</p>
            {picking === "multi" ? (
              <span className="mt-4 inline-block text-sm text-primary">进入登录…</span>
            ) : (
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                登录协作 <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            )}
          </button>
        </div>

        <p className="text-center text-xs text-fg/40">可在设置中随时切换模式</p>
      </div>
    </div>
  );
}
