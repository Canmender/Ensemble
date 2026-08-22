import type { NextFunction, Request, RequestHandler, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import type { AuthUser } from "../db/users";

/**
 * 本地服务 HTTP API 认证中间件（挂载于 /api）。
 *
 * 威胁模型（server 默认仅绑定 127.0.0.1）：
 * - 浏览器中的恶意网页发起跨站请求（CSRF / 跨源读取）→ 用 Bearer token 拦截。
 *   携带 Authorization header 的请求会触发 CORS preflight，浏览器因无跨源许可
 *   直接拦截；不携带 header 的简单请求统一被 401 拒绝。
 * - 本机其他进程"顺便"访问 localhost 端口 → Bearer token 使其需要先主动提取 token
 *   （纵深防御；本机进程仍可通过内存/命令行读取绕过，属固有局限）。
 * - 恶意网页盗取 bootstrap token（/api/ws-token）→ Origin/Referer 校验拒绝非本机来源。
 *
 * 凭证（按序判定，命中即放行）：
 * 1. 用户 session token（sessions 表）→ 附加 req.user（多用户服务器模式）
 * 2. 机器 API key（ENSEMBLE_API_KEY）→ req.user = { role: "system" }（headless/Docker/移动端直连）
 * 3. 设备 token（桌面本地）→ 放行但无 req.user（本地单用户，不隔离）
 *
 * 例外端点：
 * - publicPaths：无需认证（如 /api/health 探活，不暴露敏感数据）。
 * - originGuardPaths：仅校验来源、不校验 token（如 /api/ws-token，前端首次获取 token 的入口）。
 */

/** 回环主机集合（含 IPv6）。恶意网页的 Origin host 不在此集合内。 */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** 浏览器 fetch 跨源请求必带 Origin；表单/script/img 等带 Referer。两者皆无 → 非浏览器客户端。 */
function isLocalOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const source = origin ?? referer;
  if (!source) return true; // curl / React Native / Electron file:// 等，无跨站来源信息
  try {
    const host = new URL(source).hostname.replace(/^\[|\]$/g, "");
    return LOCAL_HOSTS.has(host);
  } catch {
    return false;
  }
}

/** timing-safe 字符串比较，防止时序攻击 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** 提取 `Authorization: Bearer <token>` */
function extractBearer(auth: string | undefined): string | null {
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m ? m[1].trim() : null;
}

export interface ApiAuthOptions {
  /** 设备级 token（桌面本地，无用户）；未配置时跳过该凭证 */
  getToken?: () => string;
  /** 解析用户 session token → AuthUser（多用户服务器模式）；未配置时跳过 */
  resolveUser?: (token: string) => AuthUser | undefined;
  /** 机器 API key（headless/Docker/移动端直连），命中时 req.user = { role: "system" } */
  apiKey?: string;
  /** 无需认证的端点（相对 /api 挂载点的路径），如 ["/health"] */
  publicPaths?: string[];
  /** 仅校验来源的 bootstrap 端点，如 ["/ws-token"] */
  originGuardPaths?: string[];
}

export function apiAuth(opts: ApiAuthOptions): RequestHandler {
  const publicPaths = new Set(opts.publicPaths ?? []);
  const originGuardPaths = new Set(opts.originGuardPaths ?? []);

  return (req: Request, res: Response, next: NextFunction) => {
    const path = req.path;

    // 公开端点（探活等）：仅允许 GET，避免非 GET 方法绕过 token
    if (publicPaths.has(path)) {
      if (req.method !== "GET") {
        return res.status(405).json({ error: { code: "method_not_allowed", message: "Method Not Allowed" } });
      }
      return next();
    }

    // Bootstrap 端点：仅限 GET + 本机来源，防恶意网页盗取 session token
    if (originGuardPaths.has(path)) {
      if (req.method !== "GET") {
        return res.status(405).json({ error: { code: "method_not_allowed", message: "Method Not Allowed" } });
      }
      if (!isLocalOrigin(req)) {
        return res
          .status(403)
          .json({ error: { code: "forbidden_origin", message: "Origin not allowed" } });
      }
      return next();
    }

    // 其余端点：要求 Bearer token，按序判定凭证
    const token = extractBearer(req.headers.authorization);
    if (!token) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="ensemble"');
      return res.status(401).json({ error: { code: "unauthorized", message: "Missing or invalid API token" } });
    }

    // ① 用户 session token（多用户服务器模式）→ 附加 req.user
    if (opts.resolveUser) {
      const user = opts.resolveUser(token);
      if (user) {
        req.user = user;
        return next();
      }
    }

    // ② 机器 API key → req.user = system
    if (opts.apiKey && safeEqual(token, opts.apiKey)) {
      req.user = { id: "", username: "system", role: "system" };
      return next();
    }

    // ③ 设备 token（桌面本地，无 req.user）
    if (opts.getToken && safeEqual(token, opts.getToken())) {
      return next();
    }

    res.setHeader("WWW-Authenticate", 'Bearer realm="ensemble"');
    return res.status(401).json({ error: { code: "unauthorized", message: "Missing or invalid API token" } });
  };
}
