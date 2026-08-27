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
import { conversationsRouter } from "./api/routes/conversations";
import { privacyRouter } from "./api/routes/privacy";
import { devicesRouter } from "./api/routes/devices";
import { uploadRouter } from "./api/routes/upload";
import { appVersionRouter } from "./api/routes/app-version";
import { initRelayClient } from "./api/routes/relay";
import { userPluginsRouter } from "./api/routes/user-plugins";
import { pairsRouter } from "./api/routes/pairs";
import { groupsRouter, userSearchRouter } from "./api/routes/groups";
import { reactionsRouter } from "./api/routes/reactions";
import { orgRouter } from "./api/routes/org";
import { RouterRegistry } from "./plugins/routers";
import { apiAuth } from "./api/auth";
import { authRouter } from "./api/routes/auth";
import { assistantRouter } from "./api/routes/assistant";
import { tokensRouter } from "./api/routes/tokens";
import { e2eRouter } from "./api/routes/e2e";

export interface CreateAppOptions {
  /** 托管前端静态资源目录（桌面 prod 同源加载） */
  staticDir?: string;
}

/** 简单的内存速率限制中间件（仅限写入方法 POST/PUT/PATCH/DELETE） */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
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
    // 只对写方法计数（GET 探活/读取不占用配额）
    if (!WRITE_METHODS.has(req.method)) return next();

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

/**
 * CORS 源白名单判定：
 * - 本机开发端口（localhost / 127.0.0.1 任意端口，Vite dev server 等）
 * - 云端部署自身地址（ctx.env.cloudHost，供浏览器版跨域直连云端）
 * 其余一律不回 CORS 头（浏览器侧被同源策略拦截；非浏览器客户端不受影响）。
 */
export function isAllowedOrigin(origin: string, cloudHost?: string): boolean {
  if (!/^https?:\/\//i.test(origin)) return false;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  const ch = cloudHost?.trim().replace(/\/+$/, "");
  if (ch && origin.toLowerCase() === `http://${ch.toLowerCase()}`) return true;
  return false;
}

export function createApp(ctx: AppContext, opts: CreateAppOptions = {}): express.Express {
  const app = express();

  // CORS 中间件：仅白名单源（本机开发端口 + 云端自身地址）
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isAllowedOrigin(origin, ctx.env.cloudHost)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Max-Age', '86400');
    }

    // 处理预检请求
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    next();
  });

  // 25MB：支持聊天图片/文件的 base64 上传（膨胀 ~33%，20MB 文件上限）
  app.use(express.json({ limit: "10mb" }));

  // 聊天附件静态服务（图片/文件；URL 直接内嵌在消息里，由消息 API 权限控制内容，静态文件本身公开）
  app.use("/uploads", express.static(ctx.uploadsDir));

  // 移动端应用包托管（APK 文件，供应用内更新下载）
  app.use("/apk", express.static(ctx.apkDir));

  // 用户认证路由（注册/登录/会话）—— 挂在 apiAuth 之前，登录无需已有 token
  app.use("/api/auth", authRouter(ctx));

  // API 认证：三凭证按序判定（用户 session → 机器 API key → 设备 token）。
  // 除 health（探活）与 ws-token（bootstrap，仅本机来源）外，所有 /api/* 要求 Bearer。
  app.use(
    "/api",
    apiAuth({
      getToken: () => ctx.hub.sessionToken,
      resolveUser: (token) => ctx.userStore.getUserBySessionToken(token),
      apiKey: ctx.env.apiKey,
      publicPaths: ["/health", "/app-version", "/settings"],
      originGuardPaths: ["/ws-token"],
    }),
  );

  // 全部写端点速率限制（POST/PUT/PATCH/DELETE，每分钟最多 60 次/ IP）。
  const imRl = ctx.config.getSettings().im?.rateLimit;
  const writeRateLimiter = createWriteRateLimiter(imRl?.windowMs, imRl?.max);
  app.use("/api", writeRateLimiter);

  // 路由统一经 RouterRegistry 注册后按序挂载（R3-C）：内置 21 条先注册即先挂，
  // 插件路由（ctx.routerRegistry）随后追加——路径与中间件顺序契约不变。
  const routerRegistry = new RouterRegistry();
  routerRegistry.register("/api/agents", agentsRouter(ctx));
  routerRegistry.register("/api/tasks", tasksRouter(ctx));
  routerRegistry.register("/api/runs", runsRouter(ctx));
  routerRegistry.register("/api/workflows", workflowsRouter(ctx));
  routerRegistry.register("/api/health", healthRouter(ctx));
  routerRegistry.register("/api/providers", providersRouter(ctx));
  routerRegistry.register("/api/settings", settingsRouter(ctx));
  routerRegistry.register("/api/mcp", mcpRouter(ctx));
  routerRegistry.register("/api/skills", skillsRouter(ctx));
  routerRegistry.register("/api/memory", memoryRouter(ctx));
  routerRegistry.register("/api/memory-pool", memoryPoolRouter(ctx));
  routerRegistry.register("/api/discovery", discoveryRouter(ctx));
  routerRegistry.register("/api/relay", relayRouter(ctx));
  routerRegistry.register("/api/chat", chatRouter(ctx));
  routerRegistry.register("/api/conversations", conversationsRouter(ctx));
  routerRegistry.register("/api/groups", groupsRouter(ctx));
  routerRegistry.register("/api/users", userSearchRouter(ctx));
  routerRegistry.register("/api/privacy", privacyRouter(ctx));
  routerRegistry.register("/api/devices", devicesRouter(ctx));
  routerRegistry.register("/api/upload", uploadRouter(ctx));
  routerRegistry.register("/api/app-version", appVersionRouter(ctx));
  routerRegistry.register("/api/assistant", assistantRouter(ctx));
  routerRegistry.register("/api/tokens", tokensRouter(ctx));
  routerRegistry.register("/api/e2e", e2eRouter(ctx));
  routerRegistry.register("/api/users/me/plugins", userPluginsRouter(ctx));
  routerRegistry.register("/api/pairs", pairsRouter(ctx));
  routerRegistry.register("/api/reactions", reactionsRouter(ctx));
  routerRegistry.register("/api/org", orgRouter(ctx));
  for (const { path, router } of routerRegistry.list()) {
    app.use(path, router);
  }
  ctx.routerRegistry = routerRegistry;

  // 自用：桌面端启动自动连接云端中继（移动端 IM/遥控入口）
  initRelayClient(ctx);

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

  // SIGTERM 优雅关机：通知客户端 → 等待重连 → 关闭 WS → 关闭 DB → 退出
  process.on("SIGTERM", async () => {
    console.log("[shutdown] 收到 SIGTERM，开始优雅关机...");
    ctx.hub.broadcastShutdown("服务器即将重启，请稍后重连");
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    ctx.hub.close();
    ctx.db.close();
    process.exit(0);
  });

  return app;
}