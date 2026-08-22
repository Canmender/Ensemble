import { useMemo, useState } from "react";
import { Cloud, Loader2, PlugZap, Server, ShieldCheck } from "lucide-react";
import { Button, Card, cls } from "../components/ui";
import { clearCloudBase } from "../lib/apiBase";

/** 规范化用户输入：去掉协议前缀与尾部斜杠，保留 host[:port] */
function normalizeHost(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

/**
 * 云端版首启引导：填云端地址 → 连通性测试 → 保存 → 进入登录。
 * 地址保存到本机 settings（云端版独立工作区），登录页据此直连云端。
 */
export default function CloudSetupPage({ onDone }: { onDone: () => void }) {
  const [host, setHost] = useState("");
  const [relayUrl, setRelayUrl] = useState("");
  const [relayKey, setRelayKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const normalizedHost = useMemo(() => normalizeHost(host), [host]);
  const canSave = normalizedHost.length > 0 && !saving;

  const runTest = async () => {
    if (!normalizedHost || testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await (window as any).desktop?.testCloudHost?.(normalizedHost);
      setTestResult(r ?? { ok: false, error: "桌面桥不可用" });
    } catch (e) {
      setTestResult({ ok: false, error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const body: Record<string, unknown> = { cloudHost: normalizedHost };
      const relay = relayUrl.trim() || relayKey.trim()
        ? { url: normalizeHost(relayUrl) ? `http://${normalizeHost(relayUrl)}` : undefined, key: relayKey.trim() || undefined }
        : undefined;
      if (relay && (relay.url || relay.key)) body.relay = relay;

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      }
      clearCloudBase();
      onDone();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-bg px-6">
      <Card className="w-full max-w-md p-6">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Cloud className="h-5 w-5 text-primary" />
          </span>
          <div>
            <h1 className="text-lg font-bold text-fg">连接到云端</h1>
            <p className="text-xs text-muted">云端版 · 填写一次即可，配置保存在本机独立工作区</p>
          </div>
        </div>

        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg/80">
          <Server className="h-3.5 w-3.5" /> 云端服务器地址
        </label>
        <input
          value={host}
          onChange={(e) => {
            setHost(e.target.value);
            setTestResult(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runTest();
          }}
          placeholder="例如 123.45.67.89:8787"
          autoFocus
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-muted/60 focus:border-primary/60 focus:outline-none"
        />

        <div className="mt-2 flex items-center gap-2">
          <Button variant="secondary" onClick={() => void runTest()} disabled={!normalizedHost || testing}>
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
            {testing ? "测试中…" : "测试连接"}
          </Button>
          {testResult && (
            <span className={cls("text-xs", testResult.ok ? "text-success" : "text-destructive")}>
              {testResult.ok ? "✓ 连接成功，是合鸣服务器" : `✗ ${testResult.error ?? "连接失败"}`}
            </span>
          )}
        </div>

        <details className="mt-4 text-xs text-muted">
          <summary className="cursor-pointer select-none hover:text-fg">中继配置（可选，手机遥控需要）</summary>
          <div className="mt-2 space-y-2">
            <input
              value={relayUrl}
              onChange={(e) => setRelayUrl(e.target.value)}
              placeholder="中继地址，如 123.45.67.89:8888"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-muted/60 focus:border-primary/60 focus:outline-none"
            />
            <input
              value={relayKey}
              onChange={(e) => setRelayKey(e.target.value)}
              type="password"
              placeholder="中继密钥（如服务器启用了鉴权）"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-muted/60 focus:border-primary/60 focus:outline-none"
            />
          </div>
        </details>

        {saveError && <p className="mt-3 text-xs text-destructive">保存失败：{saveError}</p>}

        <Button
          variant="primary"
          className="mt-5 w-full"
          onClick={() => void save()}
          disabled={!canSave}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {saving ? "保存中…" : "保存并进入登录"}
        </Button>

        <p className="mt-3 text-center text-[11px] leading-relaxed text-muted">
          地址格式 host:port；登录/注册账号在云端服务器上创建，
          <br />
          与手机端共用同一套账号与数据。
        </p>
      </Card>
    </div>
  );
}
