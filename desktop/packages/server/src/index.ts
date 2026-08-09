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
  const app = createApp(ctx);
  const server: Server = createServer(app);

  ctx.hub.attach(server, "/ws");
  ctx.hub.onClientMessage = (msg) => {
    if (msg.type === "cancel") {
      logger.info(`cancel requested for run ${msg.runId}`);
      ctx.engine.cancelRun(msg.runId);
    }
  };

  server.listen(env.port, () => {
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
