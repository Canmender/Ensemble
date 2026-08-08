import { BrowserWindow, dialog, ipcMain, app, shell } from "electron";
import { join } from "node:path";
import { IPC } from "../shared/ipc";

export function createWindow(loadUrl: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: "MultiAgent",
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
  ipcMain.handle(IPC.openConfigDir, async () => {
    const dir = app.getPath("userData");
    await shell.openPath(dir);
    return dir;
  });

  // 工具执行确认对话框（P2 工具安全）
  ipcMain.handle(
    IPC.confirmTool,
    async (_e, payload: { tool: string; args: unknown }) => {
      const text = `${payload.tool}\n\n参数: ${JSON.stringify(payload.args, null, 2)}`;
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
