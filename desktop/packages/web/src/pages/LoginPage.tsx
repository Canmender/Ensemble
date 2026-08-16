import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Button, Input, Label } from "../components/ui";
import { getMode } from "../lib/mode";

/** 登录页：本地多用户部署走相对路径；多端协作模式走云端服务器（可配置地址） */
export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [serverHost, setServerHost] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const isMulti = getMode() === "multi";

  // 多端协作：读取已保存的云端服务器地址（settings.cloudHost）
  useEffect(() => {
    if (!isMulti) return;
    fetch("/api/settings")
      .then((r) => r.ok ? r.json() : null)
      .then((d: { data?: { cloudHost?: string; relay?: { url?: string } } } | null) => {
        const host = d?.data?.cloudHost || (d?.data?.relay?.url ? new URL(d.data.relay.url).hostname : "");
        setServerHost(host);
      })
      .catch(() => setServerHost(""));
  }, [isMulti]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const base = isMulti && serverHost.trim() ? `http://${serverHost.trim().replace(/\/+$/, "")}` : "";
      const url = isMulti ? `${base}/api/auth/login` : "/api/auth/login";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const json = (await res.json()) as { data?: { token: string; user: Parameters<typeof login>[1] }; error?: { message?: string } };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? "登录失败");
        return;
      }
      login(json.data.token, json.data.user);
      navigate("/");
    } catch {
      setError("网络错误，请检查服务器地址或网络");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-surface p-8 shadow-lg">
        <div>
          <h1 className="text-xl font-semibold text-fg">登录合鸣</h1>
          <p className="mt-1 text-sm text-fg/60">{isMulti ? "多端协作 · 连接云端服务器" : "企业级多 Agent 协作平台"}</p>
        </div>

        {isMulti && (
          <div className="space-y-2">
            <Label>云端服务器地址</Label>
            <Input
              value={serverHost}
              onChange={(e) => setServerHost(e.target.value)}
              placeholder="your-server:8787"
            />
          </div>
        )}

        <div className="space-y-2">
          <Label>用户名</Label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" autoFocus required />
        </div>
        <div className="space-y-2">
          <Label>密码</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••" required />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "登录中…" : "登录"}
        </Button>

        {!isMulti && (
          <p className="text-center text-sm text-fg/60">
            还没有账号？{" "}
            <Link to="/register" className="text-primary hover:underline">
              注册
            </Link>
          </p>
        )}
      </form>
    </div>
  );
}
