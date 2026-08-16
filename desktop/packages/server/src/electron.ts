import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { hostname } from "node:os";
import { getEnv, type ServerEnv } from "./config/env";
import { openDb } from "./db/sqlite";
import { createAppContext, type AppContext } from "./context";
import { createApp } from "./app";
import { advertiseEnsembleService } from "./discovery/advertise";
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
  });
  const staticDir =
    opts.staticDir && existsSync(opts.staticDir) ? opts.staticDir : undefined;

  const app = createApp(ctx, { staticDir });
  const server = createServer(app);
  ctx.hub.attach(server, "/ws", (token) => ctx.userStore.getUserBySessionToken(token));
  ctx.hub.onClientMessage = (msg) => {
    if (msg.type === "cancel") ctx.engine.cancelRun(msg.runId);
    if (msg.type === "steer" && msg.content) ctx.engine.addSteering(msg.runId, msg.content);
    if (msg.type === "tool_confirm" && msg.confirmId) ctx.hub.resolveConfirm(msg.confirmId, msg.approved ?? false);
  };

  // WebRTC 通话信令：A → (hub) → B 定向转发；目标离线/未上线时忽略。
  // runId 用占位 "call"（非空）：桌面端 ws 客户端会按 runId 建 run 缓存，空 runId 会产生污染条目。
  ctx.hub.onCallSignal = (fromUserId, fromName, targetUserId, call) => {
    ctx.hub.sendToUser(targetUserId, { type: "call.signal", fromUserId, fromName, call }, "call");
  };

  return new Promise((resolve, reject) => {
    // 默认仅绑定 127.0.0.1；配置 ENSEMBLE_LAN_HOST 时绑定局域网（移动端直连）
    const host = env.lanHost && env.lanHost !== "127.0.0.1" && env.lanHost !== "::1" ? env.lanHost : "127.0.0.1";
    if (host !== "127.0.0.1" && !env.apiKey) {
      logger.warn(
        `监听地址为 ${host}（局域网可见）但未配置 ENSEMBLE_API_KEY，局域网内设备可获取 session token 访问全部 API。`,
      );
    }
    let stopAdvertise: (() => void) | undefined;

    server.once("error", reject);
    server.listen(opts.port ?? 0, host, () => {
      const { port } = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${port}`;
      logger.info(`local server listening at ${url}`);
      // 局域网模式：发布 mDNS 供移动端发现（HTTP 与 WS 同端口）
      if (host !== "127.0.0.1") {
        const deviceId = `desktop-${hostname().replace(/[^a-zA-Z0-9]/g, "-")}`;
        stopAdvertise = advertiseEnsembleService({ httpPort: port, wsPort: port, deviceId });
      }
      resolve({
        port,
        url,
        ctx,
        server,
        close: () =>
          new Promise((res) => {
            stopAdvertise?.();
            void ctx.dispose().finally(() => {
              server.close(() => {
                try {
                  db.close();
                } catch {
                  /* already closed */
                }
                res();
              });
            });
          }),
      });
    });
  });
}