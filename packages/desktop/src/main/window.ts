import { BrowserWindow, dialog, ipcMain, app, shell } from "electron";
import { join } from "node:path";
import { IPC } from "../shared/ipc";

export function createWindow(loadUrl: string): BrowserWindow {
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
