import express, { type NextFunction, type Request, type Response } from "express";
import { join } from "node:path";
import type { AppContext } from "./context";
import { agentsRouter } from "./api/routes/agents";
import { tasksRouter } from "./api/routes/tasks";
import { runsRouter } from "./api/routes/runs";
import { workflowsRouter } from "./api/routes/workflows";
import { healthRouter } from "./api/routes/health";
import { providersRouter } from "./api/routes/providers";
import { settingsRouter } from "./api/routes/settings";
import { mcpRouter } from "./api/routes/mcp";
import { skillsRouter } from "./api/routes/skills";
import { memoryRouter } from "./api/routes/memory";
import { discoveryRouter } from "./api/routes/discovery";
import { relayRouter } from "./api/routes/relay";

export interface CreateAppOptions {
  /** 托管前端静态资源目录（桌面 prod 同源加载） */
  staticDir?: string;
}

export function createApp(ctx: AppContext, opts: CreateAppOptions = {}): express.Express {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.use("/api/agents", agentsRouter(ctx));
  app.use("/api/tasks", tasksRouter(ctx));
  app.use("/api/runs", runsRouter(ctx));
  app.use("/api/workflows", workflowsRouter(ctx));
  app.use("/api/health", healthRouter(ctx));
  app.use("/api/providers", providersRouter(ctx));
  app.use("/api/settings", settingsRouter(ctx));
  app.use("/api/mcp", mcpRouter(ctx));
  app.use("/api/skills", skillsRouter(ctx));
  app.use("/api/memory", memoryRouter(ctx));
  app.use("/api/discovery", discoveryRouter(ctx));
  app.use("/api/relay", relayRouter(ctx));

  // 托管前端静态资源 + SPA fallback（仅非 /api /ws 路径）
  const staticDir = opts.staticDir;
  if (staticDir) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/(api|ws)).*/, (_req, res, next) => {
      res.sendFile(join(staticDir, "index.html"), (err) => {
        if (err) next();
      });
    });
  }

  // 404
  app.use((_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "route not found" } });
  });

  // 统一错误处理
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    const status = (err as any)?.status ?? 500;
    if (status >= 500) console.error("[error]", message);
    res.status(status).json({ error: { code: (err as any)?.code ?? "internal", message } });
  });

  return app;
}
