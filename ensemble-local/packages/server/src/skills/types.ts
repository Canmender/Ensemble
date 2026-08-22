/** 一个 skill 的定义（SKILL.md 解析结果） */
export interface SkillDef {
  name: string;
  description: string;
  /** SKILL.md 正文（markdown） */
  body: string;
  /** skill 目录绝对路径 */
  location: string;
  updatedAt: string;
  /** 是否有 references/ 目录（按需加载） */
  hasReferences: boolean;
}

/** SKILL.md 写入输入 */
export interface SkillInput {
  name: string;
  description: string;
  body: string;
}
