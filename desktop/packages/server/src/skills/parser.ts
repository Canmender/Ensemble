import type { SkillDef } from "./types";

/**
 * 解析 SKILL.md：YAML frontmatter（name/description）+ markdown body。
 * 失败抛错（由调用方记录，不静默丢弃）。
 */
export function parseSkillMd(content: string, location: string): Omit<SkillDef, "updatedAt" | "hasReferences"> {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(content);
  if (!m) throw new Error(`SKILL.md missing frontmatter: ${location}`);

  const frontmatter = m[1];
  const body = m[2].trim();

  const name = /^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim();
  const description = /^description:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim();

  if (!name) throw new Error(`SKILL.md missing name: ${location}`);
  if (!description) throw new Error(`SKILL.md missing description: ${location}`);

  return { name, description, body, location };
}

/** 序列化为 SKILL.md 文件内容 */
export function toSkillMd(skill: { name: string; description: string; body: string }): string {
  return `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.body.trim()}\n`;
}
