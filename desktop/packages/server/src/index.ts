import { createServer, type Server } from "node:http";
import { getEnv } from "./config/env";
import { openDb } from "./db/sqlite";
import { createAppContext } from "./context";
import { createApp } from "./app";
import { logger } from "./util/logger";

async function main(): Promise<void> {
  const env = getEnv();
  const db = openDb(env.dbPath);
  const ctx = createAppContext(env, db);
  const app = createApp(ctx, env.staticDir ? { staticDir: env.staticDir } : {});
  const server: Server = createServer(app);

  ctx.hub.attach(server, "/ws");
  ctx.hub.onClientMessage = (msg) => {
    if (msg.type === "cancel") {
      logger.info(`cancel requested for run ${msg.runId}`);
      ctx.engine.cancelRun(msg.runId);
    }
    if (msg.type === "steer" && msg.content) {
      logger.info(`steering message for run ${msg.runId}`);
      ctx.engine.addSteering(msg.runId, msg.content);
    }
    if (msg.type === "tool_confirm" && msg.confirmId) {
      ctx.hub.resolveConfirm(msg.confirmId, msg.approved ?? false);
    }
  };

  // 安全：默认仅绑定 127.0.0.1。显式 ENSEMBLE_LAN_HOST 才对外绑定。
  const host = env.lanHost ?? "127.0.0.1";
  // 对外绑定但未配置固定 API key → 拒绝启动。
  // 否则局域网内任何设备可先 GET /api/ws-token 拿 session token，再 Bearer 接管全部 API。
  const isLoopback = host === "127.0.0.1" || host === "::1" || host === "localhost";
  if (!isLoopback && !env.apiKey) {
    logger.error(
      `ENSEMBLE_LAN_HOST=${host} 是对外地址但未配置 ENSEMBLE_API_KEY，为安全起见拒绝启动。`,
    );
    process.exit(1);
  }
  server.listen(env.port, host, () => {
    logger.info(`合鸣 server listening on http://localhost:${env.port}`);
    logger.info(
      `agents loaded: ${ctx.config.listAgents().map((a) => a.id).join(", ") || "(none)"}`,
    );
    if (ctx.config.errors.length) {
      logger.warn(`config errors (${ctx.config.errors.length}):`);
      for (const e of ctx.config.errors) logger.warn(`  - ${e}`);
    }
  });

  // graceful shutdown
  const shutdown = (signal: string) => {
    logger.info(`received ${signal}, shutting down...`);
    ctx.registry.disposeAll();
    ctx.hub.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("fatal startup error:", err);
  process.exit(1);
});
