import { describe, expect, it } from "vitest";
import { parseSkillMd, toSkillMd } from "../src/skills/parser";

describe("parseSkillMd", () => {
  it("解析 frontmatter + body", () => {
    const md = `---
name: code-review
description: 代码评审最佳实践
---

# 代码评审
正文内容`;
    const parsed = parseSkillMd(md, "/x/SKILL.md");
    expect(parsed.name).toBe("code-review");
    expect(parsed.description).toBe("代码评审最佳实践");
    expect(parsed.body).toContain("# 代码评审");
  });

  it("缺 frontmatter 抛错", () => {
    expect(() => parseSkillMd("no frontmatter", "/x/SKILL.md")).toThrow();
  });

  it("缺 description 抛错", () => {
    const md = "---\nname: foo\n---\nbody";
    expect(() => parseSkillMd(md, "/x/SKILL.md")).toThrow(/description/);
  });

  it("toSkillMd 可往返", () => {
    const input = { name: "foo", description: "desc", body: "body content" };
    const md = toSkillMd(input);
    const parsed = parseSkillMd(md, "/x/SKILL.md");
    expect(parsed.name).toBe("foo");
    expect(parsed.body).toBe("body content");
  });
});
