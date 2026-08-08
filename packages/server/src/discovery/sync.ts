import { readFileSync } from "node:fs";
import { parseSkillMd } from "../skills/parser";
import { readHermesFacts } from "./detect";
import type { DetectedAgent, SyncResult } from "./types";
import type { SkillStore } from "../skills";
import type { MemoryProvider } from "../memory/provider";
import type { ConfigManager } from "../appContext";

/** 同步技能：读取本地 SKILL.md → 导入 skill 池 */
export function syncAgentSkills(agent: DetectedAgent, skillStore: SkillStore): string[] {
  const imported: string[] = [];
  for (const s of agent.skills) {
    try {
      const content = readFileSync(s.sourcePath, "utf8");
      const parsed = parseSkillMd(content, s.sourcePath);
      skillStore.save({ name: parsed.name, description: parsed.description, body: parsed.body });
      imported.push(parsed.name);
    } catch {
      /* 单个 skill 失败跳过 */
    }
  }
  return imported;
}

/** 同步记忆：读取本地记忆（hermes facts 库）→ 导入平台记忆系统 */
export async function syncAgentMemory(agent: DetectedAgent, memoryProvider: MemoryProvider): Promise<number> {
  if (agent.type === "hermes" && agent.memoryDbPath) {
    const facts = readHermesFacts(agent.memoryDbPath);
    if (!facts.length) return 0;
    return memoryProvider.importFacts(agent.type, facts);
  }
  return 0;
}

/** 同步配置：为本地 agent 创建 local 类型实例（接入平台） */
export function syncAgentConfig(agent: DetectedAgent, configManager: ConfigManager): string | undefined {
  const id = agent.type === "claude" ? "claude-local" : "hermes-local";
  if (configManager.getAgent(id)) return undefined;

  const command = agent.type === "claude" ? "claude -p" : "hermes -z";
  configManager.createAgent({
    id,
    name: agent.name + " (本地)",
    kind: "local",
    description: `通过本地命令接入的 ${agent.name}`,
    local: { command, promptMode: "arg" },
    tools: [],
    enabled: false,
  } as any);
  return id;
}

/** 同步一个本地 agent 的全部数据 */
export async function syncAgent(agent: DetectedAgent, ctx: {
  skillStore: SkillStore;
  memoryProvider: MemoryProvider;
  configManager: ConfigManager;
}): Promise<SyncResult> {
  const result: SyncResult = { type: agent.type, importedSkills: [], importedMemory: 0, errors: [] };

  try {
    result.importedSkills = syncAgentSkills(agent, ctx.skillStore);
  } catch (err) {
    result.errors.push(`skills: ${String(err)}`);
  }
  try {
    result.importedMemory = await syncAgentMemory(agent, ctx.memoryProvider);
  } catch (err) {
    result.errors.push(`memory: ${String(err)}`);
  }
  try {
    result.createdAgent = syncAgentConfig(agent, ctx.configManager);
  } catch (err) {
    result.errors.push(`config: ${String(err)}`);
  }
  return result;
}
