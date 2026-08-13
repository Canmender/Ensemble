import { Router } from "express";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppContext } from "../../context";
import { asyncH, fail, ok } from "./helpers";
import { newId } from "../../util/id";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB

/** 从文件名提取安全扩展名（仅字母数字，防路径穿越） */
function extFromName(name: string): string {
  const m = /\.([a-zA-Z0-9]{1,10})$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

/**
 * 聊天附件上传端点：接收 base64 JSON（{ name, mime, data }），保存到 uploads 目录，返回可访问 url。
 * 用 base64 而非 multipart：跨端（web FileReader / RN expo-file-system）最简单，零新依赖。
 */
export function uploadRouter(ctx: AppContext): Router {
  const r = Router();

  r.post(
    "/",
    asyncH(async (req, res) => {
      const body = (req.body ?? {}) as { name?: unknown; mime?: unknown; data?: unknown };
      const name = typeof body.name === "string" && body.name ? body.name.slice(0, 255) : "upload";
      const mime = typeof body.mime === "string" && body.mime ? body.mime : "application/octet-stream";
      const data = typeof body.data === "string" ? body.data : "";
      if (!data) return fail(res, new Error("data (base64) required"), 400);

      let buf: Buffer;
      try {
        buf = Buffer.from(data, "base64");
      } catch {
        return fail(res, new Error("invalid base64"), 400);
      }
      if (buf.length === 0) return fail(res, new Error("empty file"), 400);
      if (buf.length > MAX_UPLOAD_BYTES) {
        return fail(res, new Error(`文件过大（上限 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB）`), 413);
      }

      const ext = extFromName(name);
      const filename = `${newId("upl")}${ext ? `.${ext}` : ""}`;
      writeFileSync(join(ctx.uploadsDir, filename), buf);

      ok(
        res,
        {
          url: `/uploads/${filename}`,
          name,
          size: buf.length,
          mime,
          type: mime.startsWith("image/") ? "image" : "file",
        },
        201,
      );
    }),
  );

  return r;
}
