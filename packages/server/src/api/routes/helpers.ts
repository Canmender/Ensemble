import type { NextFunction, Request, Response } from "express";

/** 统一成功响应：{ data } */
export function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ data });
}

/** 统一错误响应：{ error: { code, message } } */
export function fail(res: Response, err: unknown, status = 400): void {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof Error ? (err as any).code : undefined;
  res.status(status).json({ error: { code: code ?? "error", message } });
}

/** 包裹 async 路由处理器，把异常传给 express 错误中间件 */
export function asyncH(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}
