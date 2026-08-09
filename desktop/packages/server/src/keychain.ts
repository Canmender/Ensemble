import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** 密钥存储抽象：明文只在 main 进程内存中。 */
export interface KeyStore {
  get(providerId: string): string | undefined;
  set(providerId: string, key: string): void;
  has(providerId: string): boolean;
  delete(providerId: string): void;
}

/** 明文文件存储（CLI / 开发模式兜底，会打警告） */
export class FileKeyStore implements KeyStore {
  private cache: Record<string, string> = {};

  constructor(private file: string) {
    this.load();
  }

  private load(): void {
    try {
      this.cache = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      this.cache = {};
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.cache, null, 2), "utf8");
  }

  get(id: string): string | undefined {
    return this.cache[id];
  }

  set(id: string, key: string): void {
    this.cache[id] = key;
    this.save();
  }

  has(id: string): boolean {
    return id in this.cache;
  }

  delete(id: string): void {
    delete this.cache[id];
    this.save();
  }
}
