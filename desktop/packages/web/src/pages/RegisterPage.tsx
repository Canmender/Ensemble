import { cloudFetchOrDirect } from "../lib/cloudHttp";
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { getCloudBase } from "../lib/apiBase";
import { Button, Input, Label } from "../components/ui";

/** 注册页 */
export default function RegisterPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setError("密码至少 6 位");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const base = await getCloudBase();
      const res = await cloudFetchOrDirect(`${base}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, displayName: displayName || undefined }),
      });
      const json = (await res.json()) as { data?: { token: string; user: Parameters<typeof login>[1] }; error?: { message?: string } };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? "注册失败");
        return;
      }
      login(json.data.token, json.data.user);
      navigate("/");
    } catch {
      setError("网络错误，请稍后再试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-surface p-8 shadow-lg">
        <div>
          <h1 className="text-xl font-semibold text-fg">注册合鸣</h1>
          <p className="mt-1 text-sm text-fg/60">创建你的账号</p>
        </div>

        <div className="space-y-2">
          <Label>用户名</Label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="3-32 位字母数字" autoFocus required />
        </div>
        <div className="space-y-2">
          <Label>显示名称（可选）</Label>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="你的名字" />
        </div>
        <div className="space-y-2">
          <Label>密码</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 6 位" required />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "注册中…" : "注册"}
        </Button>

        <p className="text-center text-sm text-fg/60">
          已有账号？{" "}
          <Link to="/login" className="text-primary hover:underline">
            登录
          </Link>
        </p>
      </form>
    </div>
  );
}