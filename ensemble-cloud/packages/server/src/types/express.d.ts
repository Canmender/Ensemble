import type { AuthUser } from "../db/users";

/** 扩展 Express Request：认证中间件附加的当前用户（未登录/本地模式时缺省） */
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
