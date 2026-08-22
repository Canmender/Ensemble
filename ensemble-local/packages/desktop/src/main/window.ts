import { BrowserWindow, dialog, ipcMain, app, shell, session } from "electron";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { IPC } from "../shared/ipc";

/** 读取持久化的云端主机（多端协作时允许跨域到云端 REST/WS） */
function readCloudHost(): string {
  try {
    const file = join(app.getPath("userData"), "config", "settings.json");
    if (!existsSync(file)) return "";
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const host = typeof raw?.cloudHost === "string" ? raw.cloudHost.trim() : "";
    return host ? host.replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
}

export function createWindow(loadUrl: string): BrowserWindow {
  const _ch = readCloudHost();
  const connectSrcCloud = _ch ? ("http://" + _ch + " ws://" + _ch + " ") : "";
  const isDev = !!process.env.RENDERER_URL;
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: "合鸣",
    backgroundColor: "#f6f7f9",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 后台标签页降频：窗口最小化/隐藏时降低渲染帧率，节省 CPU/GPU
  win.webContents.setBackgroundThrottling(true);

  // ── 安全加固 ──────────────────────────────────────────────────────

  // 1. Content-Security-Policy — 限制资源来源
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // 开发模式放宽 CSP，允许 Vite dev server 的脚本和连接
    const csp = isDev
      ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; " +
        "style-src 'self' 'unsafe-inline'; " +
        "connect-src 'self' ws://127.0.0.1:* ws://localhost:* http://localhost:* " + connectSrcCloud + 
        "img-src 'self' data:; " +
        "object-src 'none'; " +
        "base-uri 'self'"
      : "default-src 'self'; " +
        "script-src 'self'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "connect-src 'self' ws://127.0.0.1:* " + connectSrcCloud + 
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