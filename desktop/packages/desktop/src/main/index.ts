import { app, BrowserWindow, dialog, Menu, nativeImage, Tray } from "electron";
import { join } from "node:path";
import { startLocalServer } from "./server";
import { createWindow, registerIpc } from "./window";
import { applyEditionWorkspace, EDITION_LABEL, resolveEdition, type Edition } from "./edition";
import { logger } from "@ensemble/server";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let closeServer: (() => Promise<void>) | undefined;
let isQuitting = false;

// ---------- 版本分区（本地版/云端版）----------
// 必须在单实例锁与 app.ready 之前执行：userData 分区到 editions/<edition>，
// 数据库/配置/密钥/浏览器存储按版本隔离；锁随 userData 作用域，两版可同时运行。
const edition: Edition = resolveEdition();
applyEditionWorkspace(edition);

const isDev = !app.isPackaged || !!process.env.RENDERER_URL;

// ---------- Chromium 渲染优化 ----------
// GPU 光栅化：将页面光栅化交给 GPU，减少 CPU 占用
app.commandLine.appendSwitch("enable-gpu-rasterization");
// 零拷贝：GPU 直接渲染到屏幕缓冲区，减少内存拷贝
app.commandLine.appendSwitch("enable-zero-copy");

// ---------- 单实例锁（防多开，激活已运行窗口；按版本隔离，见上方分区注释） ----------
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
  tray.setToolTip(`合鸣 · ${EDITION_LABEL[edition]}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `显示合鸣（${EDITION_LABEL[edition]}）`, click: () => showMainWindow() },
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
  // 原生窗口行为（Windows）；AUMI 按版本区分，任务栏分组/跳转列表互不混淆
  app.setAppUserModelId(`com.ensemble.system.${edition}`);

  try {
    const url = await bootstrap();
    mainWindow = createWindow(url, edition);
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
  } catch (err) {
    console.error("startup failed:", err);
    logger.error("startup failed", err instanceof Error ? `${err.message}\n${err.stack}` : String(err));
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && !isDev) {
      void bootstrap().then((url) => {
        mainWindow = createWindow(url, edition);
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
