import { Router } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppContext } from "../../context";
import { ok } from "./helpers";

/**
 * 移动端应用更新检查（公开端点，无需认证）。
 * 读取 apkDir/version.json（部署脚本写入），返回最新版本信息供应用内更新判断。
 */
export function appVersionRouter(ctx: AppContext): Router {
  const r = Router();

  r.get("/", (_req, res) => {
    const file = join(ctx.apkDir, "version.json");
    try {
      const data = JSON.parse(readFileSync(file, "utf8")) as {
        version?: string;
        versionCode?: number;
        apkUrl?: string;
        note?: string;
        force?: boolean;
      };
      ok(res, {
        version: data.version ?? "",
        versionCode: data.versionCode ?? 0,
        apkUrl: data.apkUrl ?? "",
        note: data.note ?? "",
        force: data.force ?? false,
      });
    } catch {
      // 未配置更新包：返回空，客户端判断为无更新
      ok(res, { version: "", versionCode: 0, apkUrl: "", note: "", force: false });
    }
  });

  return r;
}
