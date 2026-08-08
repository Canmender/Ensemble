import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { getEnv, type ServerEnv } from "./config/env";
import { openDb } from "./db/sqlite";
import { createAppContext, type AppContext } from "./context";
import { createApp } from "./app";
import { logger } from "./util/logger";
import type { KeyStore } from "./keychain";

export interface LocalServerOptions {
  configDir: string;
  dbPath: string;
  /** 托管前端静态资源目录（prod 桌面同源加载） */
  staticDir?: string;
  /** 固定端口（dev 用 8787 匹配 Vite 代理）；缺省随机 */
  port?: number;
  /** 密钥存储（桌面版传 Electron safeStorage 实现） */
  keyStore?: KeyStore;
  /** 工具执行确认回调 */
  askConfirm?: (tool: string, args: unknown) => Promise<boolean>;
}

export interface LocalServer {
  port: number;
  url: string;
  ctx: AppContext;
  server: Server;
  close: () => Promise<void>;
}

/**
 * 本地同源 server：Express + WebSocket，仅绑定 127.0.0.1。
 * dev 模式监听固定端口供 Vite 代理；prod 监听随机端口并托管前端静态资源。
 */
export function createLocalServer(opts: LocalServerOptions): Promise<LocalServer> {
  const env: ServerEnv = {
    ...getEnv(),
    port: opts.port ?? 0,
    configDir: opts.configDir,
    dbPath: opts.dbPath,
  };

  const db = openDb(env.dbPath);
  const ctx = createAppContext(env, db, {
    ...(opts.keyStore ? { keyStore: opts.keyStore } : {}),
    ...(opts.askConfirm ? { askConfirm: opts.askConfirm } : {}),
  });
  const staticDir =
    opts.staticDir && existsSync(opts.staticDir) ? opts.staticDir : undefined;

  const app = createApp(ctx, { staticDir });
  const server = createServer(app);
  ctx.hub.attach(server, "/ws");
  ctx.hub.onClientMessage = (msg) => {
    if (msg.type === "cancel") ctx.engine.cancelRun(msg.runId);
  };

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${port}`;
      logger.info(`local server listening at ${url}`);
      resolve({
        port,
        url,
        ctx,
        server,
        close: () =>
          new Promise((res) => {
            ctx.registry.disposeAll();
            ctx.hub.close();
            server.close(() => {
              try {
                db.close();
              } catch {
                /* already closed */
              }
              res();
            });
          }),
      });
    });
  });
}
