import { BrowserWindow, dialog, ipcMain, app, shell, session, net } from "electron";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { IPC } from "../shared/ipc";
import { EDITION_LABEL, type Edition } from "./edition";

export function createWindow(loadUrl: string, edition: Edition): BrowserWindow {
  const isDev = !!process.env.RENDERER_URL;
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: `合鸣 · ${EDITION_LABEL[edition]}`,
    backgroundColor: "#f6f7f9",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 把版本注入 renderer 进程 argv，preload 据此暴露 window.desktop.edition
      additionalArguments: [`--ensemble-edition=${edition}`],
    },
  });

  // 后台标签页降频：窗口最小化/隐藏时降低渲染帧率，节省 CPU/GPU
  win.webContents.setBackgroundThrottling(true);

  // ── 安全加固 ──────────────────────────────────────────────────────

  // 1. Content-Security-Policy — 限制资源来源
  // connect-src 用协议级通配（http: https: ws:）：Electron 43 对 onHeadersReceived
  // 注入的 CSP 里「具体 host 源」解析异常（实测 connect-src 'self' http://host 会拦掉
  // 该 host 的跨源 fetch，通配则正常——探针二分定位）。桌面客户端按协议放行可接受：
  // 用户可能连接任意自建云端（开箱即连/多服务器），主机白名单由服务端凭证体系约束。
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // 开发模式放宽 CSP，允许 Vite dev server 的脚本和连接
    const csp = isDev
      ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; " +
        "style-src 'self' 'unsafe-inline'; " +
        "connect-src 'self' ws://127.0.0.1:* ws://localhost:* http://localhost:* http: https: ws:; " +
        "img-src 'self' data:; " +
        "object-src 'none'; " +
        "base-uri 'self'"
      : "default-src 'self'; " +
        "script-src 'self'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "connect-src 'self' ws://127.0.0.1:* http: https: ws:; " +
        "img-src 'self' data:; " +
        "object-src 'none'; " +
        "base-uri 'self'";
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });

  // 2. will-navigate 守卫 — 阻止页面导航到外部地址
  win.webContents.on("will-navigate", (event, url) => {
    const parsed = new URL(url);
    const isLocal =
      parsed.protocol === "file:" ||
      (parsed.hostname === "127.0.0.1" && parsed.port !== "");
    if (!isLocal) {
      event.preventDefault();
    }
  });

  // 3. 权限请求拦截 — 拒绝不必要的浏览器权限
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  // 外部链接用系统浏览器打开（防止应用内跳走）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  void win.loadURL(loadUrl);
  return win;
}

export function registerIpc(): void {
  ipcMain.handle(IPC.appVersion, () => app.getVersion());

  // 云端 HTTP 代理：renderer 的跨源云端请求统一经主进程 net.fetch
  // （renderer CSP/webRequest 对跨源 fetch 的拦截在 Electron 43 下无法用 CSP 白名单
  // 可靠放行——探针实测 connect-src 通配仍拦，主进程代理是确定通路）。
  ipcMain.handle(IPC.cloudFetch, async (_e, payload: unknown) => {
    const p = payload as { url?: string; method?: string; headers?: Record<string, string>; body?: string };
    if (!p?.url || !/^https?:\/\//i.test(p.url)) return { status: 0, body: "invalid url" };
    if (!p.url.startsWith("http://127.0.0.1:") && !p.url.startsWith("http://localhost:")) {
      // 只允许 http(s) 明文目标（自建云端场景）；方法白名单防滥用
      const method = (p.method ?? "GET").toUpperCase();
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        return { status: 0, body: "invalid method" };
      }
    }
    try {
      const res = await net.fetch(p.url, {
        method: p.method ?? "GET",
        headers: p.headers,
        body: p.body,
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      return { status: res.status, body: text };
    } catch (e) {
      return { status: 0, body: (e as Error).message || "network error" };
    }
  });

  // 云端地址连通性测试：主进程发起（渲染层 CSP 白名单在窗口创建时固化，
  // 首启引导输入的新地址不在其中，故经 IPC 由主进程探测）
  ipcMain.handle(IPC.testCloudHost, async (_e, rawHost: unknown) => {
    const host = typeof rawHost === "string" ? rawHost.trim().replace(/\/+$/, "") : "";
    if (!host) return { ok: false, error: "地址为空" };
    const base = /^https?:\/\//i.test(host) ? host : `http://${host}`;
    try {
      const res = await net.fetch(`${base}/api/health`, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const json = (await res.json()) as { data?: { status?: string } };
      if (json?.data?.status === "ok") return { ok: true };
      return { ok: false, error: "响应不是合鸣服务器" };
    } catch (e) {
      return { ok: false, error: (e as Error).message || "连接失败" };
    }
  });

  ipcMain.handle(IPC.openConfigDir, async () => {
    const dir = app.getPath("userData");
    await shell.openPath(dir);
    return dir;
  });

  // 原生窗口控制（renderer 通过 preload 调用）
  ipcMain.handle(IPC.winMinimize, (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
  ipcMain.handle(IPC.winMaximize, (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.handle(IPC.winClose, (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  ipcMain.handle(IPC.systemInfo, () => ({
    platform: process.platform,
    arch: process.arch,
    versions: { node: process.versions.node, electron: process.versions.electron },
    uptime: process.uptime(),
  }));

  // 开机自启（Windows 登录时启动，入参强校验）
  ipcMain.handle(IPC.setAutoLaunch, (_e, enabled: unknown) => {
    const on = typeof enabled === "boolean" && enabled;
    app.setLoginItemSettings({ openAtLogin: on });
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle(IPC.isAutoLaunch, () => app.getLoginItemSettings().openAtLogin);

  // 工具执行确认对话框（P2 工具安全）
  ipcMain.handle(
    IPC.confirmTool,
    async (_e, payload: { tool?: string; args?: unknown }) => {
      if (!payload || typeof payload.tool !== "string") return false;
      const text = `${payload.tool}\n\n参数: ${JSON.stringify(payload.args ?? {}, null, 2)}`;
      const { response } = await dialog.showMessageBox({
        type: "warning",
        buttons: ["允许", "取消"],
        defaultId: 1,
        cancelId: 1,
        title: "确认执行工具",
        message: `Agent 请求执行工具 ${payload.tool}`,
        detail: text.slice(0, 2000),
      });
      return response === 0;
    },
  );
}