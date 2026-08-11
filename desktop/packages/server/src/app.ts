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
import { memoryPoolRouter } from "./api/routes/memory-pool";
import { discoveryRouter } from "./api/routes/discovery";
import { relayRouter } from "./api/routes/relay";
import { chatRouter } from "./api/routes/chat";
import { apiAuth } from "./api/auth";

export interface CreateAppOptions {
  /** 托管前端静态资源目录（桌面 prod 同源加载） */
  staticDir?: string;
}

/** 简单的内存速率限制中间件（仅限写入端点） */
function createWriteRateLimiter(windowMs: number = 60_000, max: number = 60) {
  const store = new Map<string, { count: number; resetAt: number }>();

  // 定期清理过期条目
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (now >= entry.resetAt) store.delete(key);
    }
  }, 5 * 60_000);

  // 允许 Node 在进程退出时清理定时器（避免测试泄漏）
  if (timer.unref) timer.unref();

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    let entry = store.get(ip);

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(ip, entry);
    }

    entry.count++;

    if (entry.count > max) {
      res.status(429).json({
        error: { code: "rate_limited", message: "请求过于频繁，请稍后再试" },
      });
      return;
    }

    next();
  };

  return middleware;
}

export function createApp(ctx: AppContext, opts: CreateAppOptions = {}): express.Express {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  // API 认证：除 health（探活）与 ws-token（bootstrap，仅本机来源）外，
  // 所有 /api/* 端点要求 Authorization: Bearer <sessionToken>。
  app.use(
    "/api",
    apiAuth({
      getToken: () => ctx.hub.sessionToken,
      publicPaths: ["/health"],
      originGuardPaths: ["/ws-token"],
    }),
  );

  // 写入端点速率限制（每分钟最多 60 次请求）
  const writeRateLimiter = createWriteRateLimiter();
  app.use("/api/tasks", writeRateLimiter);
  app.use("/api/chat", writeRateLimiter);

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
  app.use("/api/memory-pool", memoryPoolRouter(ctx));
  app.use("/api/discovery", discoveryRouter(ctx));
  app.use("/api/relay", relayRouter(ctx));
  app.use("/api/chat", chatRouter(ctx));

  // WebSocket token endpoint：前端获取 session token 用于建立 WS 连接。
  // 配置固定 API key（headless/Docker）时禁用，防止公网绑定下 token 被任意获取。
  app.get("/api/ws-token", (_req, res) => {
    if (ctx.env.apiKey) {
      res.status(404).json({ error: { code: "not_found", message: "ws-token disabled when ENSEMBLE_API_KEY is set" } });
      return;
    }
    res.json({ token: ctx.hub.sessionToken });
  });

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
