import { Router } from "express";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { AppContext } from "../../context";
import { asyncH, fail, ok } from "./helpers";
import { newId } from "../../util/id";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100MB（对齐 V-IM）

/** 从文件名提取安全扩展名（仅字母数字，防路径穿越） */
function extFromName(name: string): string {
  const m = /\.([a-zA-Z0-9]{1,10})$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

/** 按日期分目录存储（对齐 box-im/V-IM） */
function dateDir(): string {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

/** 计算文件 MD5 */
function md5(buf: Buffer): string {
  return createHash("md5").update(buf).digest("hex");
}

/**
 * 聊天附件上传端点：base64 JSON（{ name, mime, data }）。
 * - 大小上限 100MB（对齐 V-IM）
 * - MD5 去重：相同文件秒传（对齐 box-im）
 * - 日期目录存储：uploads/2026/08/14/upl_xxx.jpg
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

      // MD5 去重：查询是否已存在相同文件
      const hash = md5(buf);
      try {
        const existing = ctx.db.prepare(
          "SELECT url, name, size, mime, type FROM upload_files WHERE md5 = ?"
        ).get(hash) as any;
        if (existing) {
          return ok(res, {
            url: existing.url,
            name: existing.name,
            size: existing.size,
            mime: existing.mime,
            type: existing.type,
          });
        }
      } catch {}

      const ext = extFromName(name);
      const dir = dateDir();
      const uploadDir = join(ctx.uploadsDir, dir);
      mkdirSync(uploadDir, { recursive: true });
      const filename = `${newId("upl")}${ext ? `.${ext}` : ""}`;
      const url = `/uploads/${dir}/${filename}`;
      writeFileSync(join(uploadDir, filename), buf);

      const type = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "file";

      // 记录文件信息（MD5 去重用）
      try {
        ctx.db.prepare(
          "INSERT INTO upload_files (id, md5, url, name, size, mime, type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(newId("upl"), hash, url, name, buf.length, mime, type, new Date().toISOString());
      } catch {}

      ok(res, { url, name, size: buf.length, mime, type }, 201);
    }),
  );

  return r;
}
