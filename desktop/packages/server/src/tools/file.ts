import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, realpathSync } from "node:fs";
import { resolve, join, normalize, isAbsolute, dirname } from "node:path";
import type { AgentTool, ToolContext } from "./types";
import { checkFileReadAllowed, checkFileWriteAllowed } from "./security";

/** 路径安全：归一化后必须落在 workspaceRoot 内（防 .. 逃逸 + symlink 逃逸） */
function safeResolve(workspaceRoot: string | undefined, userPath: string, cwd?: string): string {
  const root = normalize(workspaceRoot ?? cwd ?? process.cwd());
  const abs = isAbsolute(userPath) ? normalize(userPath) : resolve(root, userPath);
  const rel = root.split(/[\\/]/).join("/");
  const target = abs.split(/[\\/]/).join("/");
  if (!target.startsWith(rel + "/") && target !== rel) {
    throw new Error(`path outside workspace: ${userPath}`);
  }
  // Resolve symlinks to prevent symlink-based escape attacks.
  // For new files that don't exist yet, resolve the parent directory instead.
  let realPath: string;
  try {
    realPath = realpathSync(abs);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      const parentDir = dirname(abs);
      try {
        realPath = join(realpathSync(parentDir), abs.split(/[\\/]/).pop()!);
      } catch {
        return abs; // parent doesn't exist yet either, will be created by caller
      }
    } else {
      throw err;
    }
  }
  const realTarget = realPath.split(/[\\/]/).join("/");
  if (!realTarget.startsWith(rel + "/") && realTarget !== rel) {
    throw new Error(`symlink target outside workspace: ${userPath}`);
  }
  return abs;
}

export const readFileTool: AgentTool = {
  name: "read_file",
  description:
    "Read a text file (path relative to workspace, or absolute within workspace). Use to inspect code/config before editing. Returns raw content up to ~12KB; larger files are truncated.",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "file path (relative to workspace)" } },
    required: ["path"],
  },
  async execute(input: unknown, ctx: ToolContext): Promise<string> {
    const denied = checkFileReadAllowed(ctx.appSettings?.security);
    if (denied) return denied;
    const { path } = input as { path: string };
    const abs = safeResolve(ctx.workspaceRoot, path, ctx.cwd);
    const content = readFileSync(abs, "utf8");
    return content.length > 12000 ? content.slice(0, 12000) + "\n...[truncated]" : content;
  },
};

export const writeFileTool: AgentTool = {
  name: "write_file",
  description: "Write content to a file (creates parent dirs). Overwrites existing.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "file path (relative to workspace)" },
      content: { type: "string", description: "full file content" },
    },
    required: ["path", "content"],
  },
  requiresConfirmation: true,
  async execute(input: unknown, ctx: ToolContext): Promise<string> {
    const denied = checkFileWriteAllowed(ctx.appSettings?.security);
    if (denied) return denied;
    const { path, content } = input as { path: string; content: string };
    const abs = safeResolve(ctx.workspaceRoot, path, ctx.cwd);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
    return `wrote ${abs} (${content.length} chars)`;
  },
};

export const listDirTool: AgentTool = {
  name: "list_dir",
  description: "List entries in a directory.",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "directory path (default: workspace root)" } },
  },
  async execute(input: unknown, ctx: ToolContext): Promise<string> {
    const denied = checkFileReadAllowed(ctx.appSettings?.security);
    if (denied) return denied;
    const { path = "." } = (input ?? {}) as { path?: string };
    const abs = safeResolve(ctx.workspaceRoot, path, ctx.cwd);
    const entries = readdirSync(abs);
    const lines = entries.map((e) => {
      const full = join(abs, e);
      try {
        const st = statSync(full);
        return st.isDirectory() ? `${e}/` : e;
      } catch {
        return e;
      }
    });
    return lines.join("\n") || "(empty directory)";
  },
};

export const fileTools: AgentTool[] = [readFileTool, writeFileTool, listDirTool];
