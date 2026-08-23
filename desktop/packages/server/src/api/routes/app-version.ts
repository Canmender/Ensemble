import { Router } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppContext } from "../../context";
import { ok } from "./helpers";

/**
 * 应用更新检查（公开端点，无需认证）。
 * GET /api/app-version        → 移动端 APK 更新（apkDir/version.json，部署脚本写入）
 * GET /api/app-version/desktop → 桌面端安装包更新（apkDir/desktop.json，部署时与 setup.exe 同放 apkDir）
 */
export function appVersionRouter(ctx: AppContext): Router {
  const r = Router();

  r.get("/desktop", (_req, res) => {
    res.set("Cache-Control", "no-store");
    const file = join(ctx.apkDir, "desktop.json");
    try {
      const data = JSON.parse(readFileSync(file, "utf8")) as {
        version?: string;
        url?: string;
        note?: string;
        force?: boolean;
      };
      ok(res, {
        version: data.version ?? "",
        url: data.url ?? "",
        note: data.note ?? "",
        force: data.force ?? false,
      });
    } catch {
      ok(res, { version: "", url: "", note: "", force: false });
    }
  });

  r.get("/", (_req, res) => {
    // 禁止缓存：应用内更新检查必须每次拿到最新版本
    res.set("Cache-Control", "no-store");
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
