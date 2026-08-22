import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseSkillMd, toSkillMd } from "./parser";
import type { SkillDef, SkillInput } from "./types";
import { logger } from "../util/logger";

/** Skill 池：扫描 <root>/<name>/SKILL.md，CRUD（SKILL.md 读写） */
export class SkillStore {
  constructor(private root: string) {}

  list(): SkillDef[] {
    let entries: string[];
    try {
      entries = readdirSync(this.root);
    } catch {
      return [];
    }
    const skills: SkillDef[] = [];
    for (const name of entries) {
      const dir = join(this.root, name);
      const file = join(dir, "SKILL.md");
      if (!existsSync(file)) continue;
      try {
        const content = readFileSync(file, "utf8");
        const parsed = parseSkillMd(content, file);
        const hasReferences = existsSync(join(dir, "references"));
        const st = statSync(file);
        skills.push({
          ...parsed,
          updatedAt: st.mtime.toISOString(),
          hasReferences,
        });
      } catch (err) {
        logger.warn(`skill ${name} parse failed: ${String(err)}`);
      }
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): SkillDef | undefined {
    return this.list().find((s) => s.name === name);
  }

  /** 按 name 列表取（池中存在才返回） */
  forNames(names: string[]): SkillDef[] {
    const pool = new Map(this.list().map((s) => [s.name, s]));
    return names.map((n) => pool.get(n)).filter((s): s is SkillDef => !!s);
  }

  save(input: SkillInput): SkillDef {
    if (!/^[a-z0-9-]+$/.test(input.name)) throw new Error(`invalid skill name: ${input.name}`);
    const dir = join(this.root, input.name);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "SKILL.md");
    writeFileSync(file, toSkillMd(input), "utf8");
    return this.get(input.name)!;
  }

  delete(name: string): void {
    const dir = join(this.root, name);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}
