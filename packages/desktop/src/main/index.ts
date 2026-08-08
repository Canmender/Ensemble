import { app, BrowserWindow, dialog, Menu, nativeImage, Tray } from "electron";
import { autoUpdater } from "electron-updater";
import { join } from "node:path";
import { startLocalServer } from "./server";
import { createWindow, registerIpc } from "./window";
import { logger } from "@ensemble/server";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let closeServer: (() => Promise<void>) | undefined;
let isQuitting = false;

const isDev = !app.isPackaged || !!process.env.RENDERER_URL;

// ---------- 单实例锁（防多开，激活已运行窗口） ----------
if (!app.requestSingleInstanceLock()) {
  // 已有实例在运行：立即退出（不继续初始化，避免双实例）
  app.quit();
  process.exit(0);
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ---------- 崩溃/异常处理 ----------
process.on("uncaughtException", (err) => {
  logger.error("uncaughtException", err instanceof Error ? `${err.message}\n${err.stack}` : String(err));
});
process.on("unhandledRejection", (reason) => {
  logger.error("unhandledRejection", reason instanceof Error ? reason.message : String(reason));
});

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

// ---------- 系统托盘 ----------
function createTray(): void {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, "icon.png")
    : join(__dirname, "../../build/icon.png");
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("合鸣");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示合鸣", click: () => showMainWindow() },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => showMainWindow());
}

function showMainWindow(): void {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}

app.whenReady().then(async () => {
  // 原生窗口行为（Windows）
  app.setAppUserModelId("com.ensemble.system");

  try {
    const url = await bootstrap();
    mainWindow = createWindow(url);
    mainWindow.on("close", (e) => {
      // 关闭窗口即退出（不残留后台）；若托盘退出则直接关
      if (!isQuitting) isQuitting = true;
      void e;
    });
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
    mainWindow.webContents.on("render-process-gone", (_e, details) => {
      logger.error("renderer process gone", JSON.stringify(details));
      void dialog.showMessageBox({
        type: "error",
        title: "合鸣",
        message: "界面进程异常退出",
        detail: `reason: ${details.reason}`,
      });
    });

    createTray();
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
          title: "合鸣更新",
          message: "新版本已下载完成",
          detail: "重启应用后将自动完成安装（后期下载新安装包可一键更新）。",
        });
        if (response === 0) {
          isQuitting = true;
          autoUpdater.quitAndInstall();
        }
      });
    }
  } catch (err) {
    console.error("startup failed:", err);
    logger.error("startup failed", err instanceof Error ? `${err.message}\n${err.stack}` : String(err));
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && !isDev) {
      void bootstrap().then((url) => {
        mainWindow = createWindow(url);
      });
    }
  });
});

app.on("window-all-closed", () => {
  // Windows：全部窗口关闭即退出（托盘已提供入口）
  if (process.platform !== "darwin") app.quit();
});

let cleanupDone = false;
app.on("before-quit", (e) => {
  isQuitting = true;
  // 等待本地服务/内存/MCP 子进程清理完成再退出（避免截断落盘）
  if (cleanupDone || !closeServer) return;
  e.preventDefault();
  void closeServer().finally(() => {
    cleanupDone = true;
    app.quit();
  });
});
