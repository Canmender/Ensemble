import { Router } from "express";
import { taskInputSchema } from "@ensemble/shared";
import type { AppContext } from "../../context";
import { asyncH, fail, ok } from "./helpers";

export function tasksRouter(ctx: AppContext): Router {
  const r = Router();

  r.get("/", (_req, res) => {
    ok(res, ctx.store.listTasks());
  });

  r.get("/:id", (req, res) => {
    const task = ctx.store.getTask(req.params.id);
    if (!task) return fail(res, new Error(`task not found: ${req.params.id}`), 404);
    const runs = ctx.store.listRuns({ taskId: task.id });
    ok(res, { task, runs });
  });

  /** 创建任务并立即执行，返回新建的 Run */
  r.post(
    "/",
    asyncH(async (req, res) => {
      const { title, input } = req.body ?? {};
      if (!title) return fail(res, new Error("title required"));
      // schema 校验并补默认值（如 chat 的 maxRounds=3）
      const parsed = taskInputSchema.safeParse(input);
      if (!parsed.success) {
        return fail(res, new Error(parsed.error.issues[0]?.message ?? "invalid input"));
      }
      const run = await ctx.engine.createAndExecuteTask(title, parsed.data);
      ok(res, run, 201);
    }),
  );

  r.post(
    "/:id/rerun",
    asyncH(async (req, res) => {
      const task = ctx.store.getTask(req.params.id);
      if (!task) return fail(res, new Error(`task not found: ${req.params.id}`), 404);
      const run = ctx.engine.executeTask(task);
      ok(res, run, 201);
    }),
  );

  r.delete("/:id", (req, res) => {
    ctx.store.deleteTask(req.params.id);
    ok(res, { deleted: req.params.id });
  });

  return r;
}
