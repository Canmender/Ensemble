import { readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import yaml from "js-yaml";
import { agentConfigSchema, workflowDefSchema } from "@ensemble/shared";
import type { AgentConfig, WorkflowDef } from "@ensemble/shared";
import { logger } from "../util/logger";

export interface LoadedConfig {
  agents: AgentConfig[];
  workflows: WorkflowDef[];
  errors: string[];
}

const now = () => new Date().toISOString();

/**
 * 从 CONFIG_DIR 加载 agent YAML 与 workflow JSON。
 * 单个文件加载/校验失败只记录错误，不阻断整体启动（health 端点会暴露错误列表）。
 */
export function loadConfig(configDir: string): LoadedConfig {
  const errors: string[] = [];

  const agents = loadAgents(configDir, errors);
  const workflows = loadWorkflows(configDir, errors);

  if (errors.length) {
    logger.warn(`config loaded with ${errors.length} error(s)`);
  }
  return { agents, workflows, errors };
}

function loadAgents(configDir: string, errors: string[]): AgentConfig[] {
  const dir = resolve(configDir, "agents");
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  } catch (err) {
    errors.push(`cannot read agents dir ${dir}: ${String(err)}`);
    return [];
  }

  const agents: AgentConfig[] = [];
  for (const file of files) {
    const abs = join(dir, file);
    try {
      const raw = yaml.load(readFileSync(abs, "utf8")) as Record<string, unknown>;
      if (!raw || typeof raw !== "object") throw new Error("empty or non-object YAML");
      const parsed = agentConfigSchema.safeParse(raw);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        errors.push(`agent ${file}: validation failed — ${issues}`);
        continue;
      }
      const cfg = parsed.data;
      agents.push({
        ...cfg,
        createdAt: cfg.createdAt ?? now(),
        updatedAt: cfg.updatedAt ?? now(),
      } as AgentConfig);
    } catch (err) {
      errors.push(`agent ${file}: ${String(err)}`);
    }
  }
  return agents;
}

function loadWorkflows(configDir: string, errors: string[]): WorkflowDef[] {
  const dir = resolve(configDir, "workflows");
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch (err) {
    errors.push(`cannot read workflows dir ${dir}: ${String(err)}`);
    return [];
  }

  const workflows: WorkflowDef[] = [];
  for (const file of files) {
    const abs = join(dir, file);
    try {
      const raw = JSON.parse(readFileSync(abs, "utf8")) as unknown;
      const parsed = workflowDefSchema.safeParse(raw);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        errors.push(`workflow ${file}: validation failed — ${issues}`);
        continue;
      }
      workflows.push(parsed.data);
    } catch (err) {
      errors.push(`workflow ${file}: ${String(err)}`);
    }
  }
  return workflows;
}
