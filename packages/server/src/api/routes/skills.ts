import { Router } from "express";
import type { AppContext } from "../../context";
import { fail, ok } from "./helpers";

/** Skill 池管理（SKILL.md 读写） */
export function skillsRouter(ctx: AppContext): Router {
  const r = Router();

  r.get("/", (_req, res) => {
    ok(res, ctx.skillStore.list());
  });

  r.get("/:name", (req, res) => {
    const skill = ctx.skillStore.get(req.params.name);
    if (!skill) return fail(res, new Error(`skill not found: ${req.params.name}`), 404);
    ok(res, skill);
  });

  r.post("/", (req, res) => {
    try {
      const { name, description, body } = req.body ?? {};
      if (!name || !description || !body) return fail(res, new Error("name/description/body required"));
      const skill = ctx.skillStore.save({ name, description, body });
      ok(res, skill, 201);
    } catch (err) {
      fail(res, err);
    }
  });

  r.put("/:name", (req, res) => {
    try {
      const existing = ctx.skillStore.get(req.params.name);
      if (!existing) return fail(res, new Error(`skill not found: ${req.params.name}`), 404);
      const { description, body } = req.body ?? {};
      const skill = ctx.skillStore.save({
        name: existing.name,
        description: description ?? existing.description,
        body: body ?? existing.body,
      });
      ok(res, skill);
    } catch (err) {
      fail(res, err);
    }
  });

  r.delete("/:name", (req, res) => {
    if (!/^[a-z0-9-]+$/.test(req.params.name)) return fail(res, new Error("invalid skill name"), 400);
    ctx.skillStore.delete(req.params.name);
    ok(res, { deleted: req.params.name });
  });

  return r;
}
