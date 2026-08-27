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
import { apiAuth } from "./api/auth";
import { authRouter } from "./api/routes/auth";
import { assistantRouter } from "./api/routes/assistant";

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

export function createApp(ctx: AppContext, opts: CreateAppOptions = {}): express.Express {
  const app = express();
  
  // CORS 中间件：允许跨域请求（桌面端开发模式需要）
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    // 允许本地开发服务器和云端服务器
    const allowedOrigins = [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:8787',
      'http://127.0.0.1:8787'
    ];
    
    if (origin && (allowedOrigins.includes(origin) || origin.startsWith('http://'))) {
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
  // 覆盖 agents/mcp/providers/settings/workflows/tasks/chat/skills/memory 等，
  // 防止批量注册 MCP 进程、批量消耗 LLM 额度等滥用。
  const writeRateLimiter = createWriteRateLimiter();
  app.use("/api", writeRateLimiter);

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
  app.use("/api/conversations", conversationsRouter(ctx));
  app.use("/api/privacy", privacyRouter(ctx));
  app.use("/api/devices", devicesRouter(ctx));
  app.use("/api/upload", uploadRouter(ctx));
  app.use("/api/app-version", appVersionRouter(ctx));
  app.use("/api/assistant", assistantRouter(ctx));

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

  return app;
}