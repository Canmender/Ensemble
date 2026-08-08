import { Router } from "express";
import type { AppContext } from "../../context";
import { asyncH, fail, ok } from "./helpers";

export function runsRouter(ctx: AppContext): Router {
  const r = Router();

  r.get("/", (req, res) => {
    const { taskId, mode, status } = req.query as Record<string, string | undefined>;
    ok(res, ctx.store.listRuns({ taskId, mode, status }));
  });

  r.get("/:id", (req, res) => {
    const run = ctx.store.getRun(req.params.id);
    if (!run) return fail(res, new Error(`run not found: ${req.params.id}`), 404);
    const jobs = ctx.store.hydrateJobEvents(ctx.store.getJobs(run.id));
    const chatMessages = ctx.store.listChatMessages(run.id);
    ok(res, { run, jobs, chatMessages });
  });

  r.get("/:id/jobs", (req, res) => {
    const run = ctx.store.getRun(req.params.id);
    if (!run) return fail(res, new Error(`run not found: ${req.params.id}`), 404);
    const jobs = ctx.store.hydrateJobEvents(ctx.store.getJobs(run.id));
    ok(res, { jobs });
  });

  /** 事件历史（WS 断线重连后 afterSeq 补拉） */
  r.get("/:id/events", (req, res) => {
    const run = ctx.store.getRun(req.params.id);
    if (!run) return fail(res, new Error(`run not found: ${req.params.id}`), 404);
    const afterSeq = Number(req.query.afterSeq ?? 0) || 0;
    const events = ctx.store.getRunEvents(run.id, afterSeq);
    ok(res, { events, lastSeq: events.length ? events[events.length - 1].seq : afterSeq });
  });

  r.post("/:id/cancel", (req, res) => {
    ctx.engine.cancelRun(req.params.id);
    ok(res, { cancelled: req.params.id });
  });

  return r;
}
