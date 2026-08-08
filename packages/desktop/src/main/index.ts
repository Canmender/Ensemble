import { app, BrowserWindow, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import { startLocalServer } from "./server";
import { createWindow, registerIpc } from "./window";
import { logger } from "@jungle/server";

let mainWindow: BrowserWindow | null = null;
let closeServer: (() => Promise<void>) | undefined;

const isDev = !app.isPackaged || !!process.env.RENDERER_URL;

async function bootstrap(): Promise<string> {
  registerIpc();

  const devUrl = process.env.RENDERER_URL;
  if (devUrl) {
    // dev：本地 server 固定 8787 供 Vite 代理；窗口加载 Vite dev server
    const local = await startLocalServer({ port: 8787 });
    closeServer = local.close;
    return devUrl;
  }

  // prod：随机端口 + 同源托管 web/dist
  const local = await startLocalServer();
  closeServer = local.close;
  return local.url;
}

app.whenReady().then(async () => {
  try {
    const url = await bootstrap();
    mainWindow = createWindow(url);
    logger.info(`window loading: ${url}`);

    // 自动更新：检测 GitHub Releases 新版本，下载后一键升级
    if (app.isPackaged) {
      autoUpdater.logger = logger as any;
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      void autoUpdater.checkForUpdatesAndNotify().catch(() => {});
      autoUpdater.on("update-downloaded", async () => {
        const { response } = await dialog.showMessageBox({
          type: "info",
          buttons: ["立即重启安装", "稍后"],
          defaultId: 0,
          title: "丛林系统更新",
          message: "新版本已下载完成",
          detail: "重启应用后将自动完成安装（后期下载新安装包可一键更新）。",
        });
        if (response === 0) autoUpdater.quitAndInstall();
      });
    }
  } catch (err) {
    console.error("startup failed:", err);
    logger.error("startup failed", err instanceof Error ? `${err.message}\n${err.stack}` : String(err));
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && !isDev) {
      void bootstrap().then((url) => (mainWindow = createWindow(url)));
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  if (closeServer) await closeServer();
});
