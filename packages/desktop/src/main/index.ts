import { app, BrowserWindow } from "electron";
import { startLocalServer } from "./server";
import { createWindow, registerIpc } from "./window";
import { logger } from "@multiagent/server";

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
