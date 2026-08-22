import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { newId } from "../util/id";

/**
 * 大工具结果 offload：写盘 + 返回相对路径（read_file 可读），
 * 消息里只保留 head/tail 预览 + read_file 指针。
 */
export class OffloadStore {
  constructor(private baseDir: string) {}

  /** 写盘并返回相对路径（agentId/file.ext），供 read_file 读取 */
  store(agentId: string, content: string): string {
    const dir = resolve(this.baseDir, agentId);
    mkdirSync(dir, { recursive: true });
    const name = `${newId("off")}.txt`;
    writeFileSync(join(dir, name), content, "utf8");
    return `${agentId}/${name}`;
  }

  read(relPath: string): string | undefined {
    try {
      return readFileSync(resolve(this.baseDir, relPath), "utf8");
    } catch {
      return undefined;
    }
  }

  /** 清理某 agent 下超过 maxAgeMs 的 offload 文件 */
  cleanup(agentId: string, maxAgeMs: number): void {
    const dir = resolve(this.baseDir, agentId);
    if (!existsSync(dir)) return;
    const now = Date.now();
    for (const f of readdirSync(dir)) {
      try {
        const st = statSync(join(dir, f));
        if (now - st.mtimeMs > maxAgeMs) unlinkSync(join(dir, f));
      } catch {
        /* ignore */
      }
    }
  }
}

/** 预览化：head + 指针 + tail，指针指向可读的相对路径 */
export function previewWithPointer(content: string, relPath: string, headChars = 1500, tailChars = 1500): string {
  const head = content.slice(0, headChars);
  const tail = content.slice(Math.max(0, content.length - tailChars));
  return `${head}\n…[中间 ${content.length - headChars - tailChars} 字符已写入 ${relPath}，可用 read_file 读取全量]…\n${tail}`;
}

/**
 * 判断是否应 offload 该工具结果：
 * 超过阈值且工具不在豁免名单（自分页/内部已截断的工具）。
 */
export function shouldOffload(tool: string, resultLength: number, threshold: number): boolean {
  const exempt = new Set(["read_file", "list_dir", "execute_command"]);
  return resultLength > threshold && !exempt.has(tool);
}
