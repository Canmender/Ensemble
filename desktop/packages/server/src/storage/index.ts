/**
 * 文件存储抽象层（P2 平台能力-子任务 2）
 *
 * 核心接口 StorageAdapter：upload / download / getSignedUrl / delete
 * 第一个实现 LocalStorageAdapter：文件落宿主机 data/uploads/ 目录（零外部依赖）
 * S3/OSS 实现按需追加，首次部署即用
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";

export interface StorageAdapter {
  /** 上传文件：返回 key（唯一标识，后续 getSignedUrl/delete 用） */
  upload(key: string, data: Buffer, options?: { mime?: string }): Promise<string>;
  /** 下载文件：返回 Buffer */
  download(key: string): Promise<Buffer>;
  /** 获取访问 URL（签名 URL 或 直接文件 URL） */
  getSignedUrl(key: string, expiresIn?: number): Promise<string>;
  /** 删除文件 */
  delete(key: string): Promise<void>;
}

/** 本地文件存储：零外部依赖，数据落宿主机 data/uploads/ 目录 */
export class LocalStorageAdapter implements StorageAdapter {
  constructor(private baseDir: string) {
    mkdirSync(baseDir, { recursive: true });
  }

  /** key 形态：upload_files 表的 url 字段，如 "uploads/2026/08/14/upl_xxx.jpg" */
  async upload(key: string, data: Buffer): Promise<string> {
    const fullPath = join(this.baseDir, key);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, data);
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const fullPath = join(this.baseDir, key);
    if (!existsSync(fullPath)) throw new Error(`文件不存在: ${key}`);
    return readFileSync(fullPath);
  }

  async getSignedUrl(key: string): Promise<string> {
    // 本地存储：直接返回相对路径 URL（由 express.static 提供文件服务）
    // 服务器已有 app.use("/uploads", express.static(ctx.uploadsDir))
    return `/${key}`;
  }

  async delete(key: string): Promise<void> {
    const fullPath = join(this.baseDir, key);
    if (existsSync(fullPath)) unlinkSync(fullPath);
  }
}
