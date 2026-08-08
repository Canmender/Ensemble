import { app } from "electron";
import { join, resolve } from "node:path";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { createLocalServer, type LocalServer, logger } from "@jungle/server";
import { createElectronKeyStore } from "./keychain";

/** 首次启动时写入的默认配置（builtin agent + 示例工作流） */
const BOOTSTRAP_AGENTS: Record<string, string> = {
  "builtin-assistant.yaml": `# 内置通用助手
id: builtin-assistant
name: 通用助手
kind: builtin
description: "内置 agent：配置 provider 后即可对话"
providerId: ""
model: ""
systemPrompt: "You are a helpful assistant."
temperature: 0.7
maxIterations: 10
tools: []
capabilities:
  sessionResume: true
  partialStreaming: true
  toolUseEvents: false
  concurrent: true
  cwdConfigurable: true
enabled: true
`,
  "builtin-researcher.yaml": `# 内置调研员（需联网工具）
id: builtin-researcher
name: 调研员
kind: builtin
description: "联网调研与资料整理（需在设置中启用 web 工具）"
providerId: ""
model: ""
systemPrompt: "You are a thorough researcher. Gather facts, cite sources, and summarize clearly."
temperature: 0.5
maxIterations: 12
tools: ["web_search", "web_fetch"]
capabilities:
  sessionResume: true
  partialStreaming: true
  toolUseEvents: true
  concurrent: true
  cwdConfigurable: true
enabled: true
`,
};

const BOOTSTRAP_WORKFLOWS: Record<string, string> = {
  "research-then-summary.json": JSON.stringify(
    {
      id: "research-then-summary",
      name: "调研 → 摘要",
      nodes: [
        { id: "research", agentId: "builtin-researcher", prompt: "Research: {{task.prompt}}" },
        { id: "summary", agentId: "builtin-assistant", prompt: "Summarize in 5 bullets: {{job.research.result}}" },
      ],
      edges: [{ from: "research", to: "summary", when: "on_success" }],
    },
    null,
    2,
  ),
};

function bootstrap(configDir: string): void {
  const agentsDir = join(configDir, "agents");
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(join(configDir, "workflows"), { recursive: true });
  mkdirSync(join(configDir, "providers"), { recursive: true });

  const agentsEmpty = !existsSync(join(agentsDir, "builtin-assistant.yaml"));
  if (agentsEmpty) {
    for (const [file, content] of Object.entries(BOOTSTRAP_AGENTS)) {
      writeFileSync(join(agentsDir, file), content, "utf8");
    }
  }
  const workflowsEmpty = !existsSync(join(configDir, "workflows", "research-then-summary.json"));
  if (workflowsEmpty) {
    for (const [file, content] of Object.entries(BOOTSTRAP_WORKFLOWS)) {
      writeFileSync(join(configDir, "workflows", file), content, "utf8");
    }
  }
}

/**
 * 启动本地 server：
 * - 配置/数据库位于 userData 目录
 * - prod 托管 web 构建产物（同源）
 * - dev 可指定端口（匹配 Vite 代理 8787）
 */
export async function startLocalServer(opts?: { port?: number }): Promise<LocalServer> {
  const userData = app.getPath("userData");
  const configDir = join(userData, "config");
  const dbPath = join(userData, "data", "jungle-system.db");
  const secretsFile = join(userData, "secrets.json");
  mkdirSync(join(userData, "data"), { recursive: true });
  bootstrap(configDir);

  const staticDir = app.isPackaged
    ? join(process.resourcesPath, "app", "dist")
    : resolve(__dirname, "../../../web/dist");
  const keyStore = createElectronKeyStore(secretsFile);

  logger.info(`configDir=${configDir} dbPath=${dbPath}`);
  return createLocalServer({ configDir, dbPath, staticDir, port: opts?.port, keyStore });
}
