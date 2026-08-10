import { api } from "./api";
import { useRunStore } from "../store/runs";
import { historyLoaded } from "./historyCache";

export interface LoadRunDetailOptions {
  /** Append historical events into the store with negative seq numbers. */
  loadEvents?: boolean;
  /** Append chatMessages into the store. */
  loadChatMessages?: boolean;
}

/**
 * Fetch a run's full detail from the API and hydrate the Zustand run store.
 *
 * The API call is always made so callers receive the full response (used by
 * RunPage for local `d.run` state).  The `historyLoaded` singleton guards
 * only the expensive store operations (events, chat messages) so list pages
 * (Dashboard, Workflows) do not re-process data that was already loaded.
 *
 * Heavy-logic callers (DashboardPage, WorkflowsPage) pass
 * `{ loadEvents: true, loadChatMessages: false }` or
 * `{ loadEvents: true, loadChatMessages: true }`.
 *
 * Light callers (RunPage, ChatPage) pass
 * `{ loadEvents: false, loadChatMessages: true }` because events are
 * delivered via WebSocket catchUp.
 */
export async function loadRunDetail(
  runId: string,
  opts: LoadRunDetailOptions = {},
): Promise<{ run: any; jobs: any[]; chatMessages: any[] } | undefined> {
  const alreadyLoaded = historyLoaded.has(runId);
  const { loadEvents = false, loadChatMessages = true } = opts;

  try {
    const d = await api.get<any>(`/runs/${runId}`);

    // Always hydrate core run state (status, finalResult)
    const store = useRunStore.getState();
    store.getOrCreate(runId);
    store.setStatus(runId, d.run.status);
    if (d.run.finalResult) store.setFinal(runId, d.run.finalResult, d.run.error);

    // Only append jobs/events/messages if not already loaded
    if (!alreadyLoaded) {
      let evSeq = 0;
      for (const job of d.jobs ?? []) {
        store.upsertJob(runId, job.id, {
          agentId: job.agentId,
          agentName: job.agentName,
          status: job.status,
          result: job.result,
          sessionId: job.sessionId,
        });
        if (loadEvents) {
          for (const ev of job.events ?? []) {
            evSeq -= 1;
            store.appendEvent(runId, { seq: evSeq, jobId: job.id, event: ev });
          }
        }
      }

      if (loadChatMessages) {
        for (const m of d.chatMessages ?? []) {
          store.appendMessage(runId, { jobId: m.jobId, agentId: m.agentId, content: m.content });
        }
      }

      historyLoaded.add(runId);
    }

    return d;
  } catch {
    /* failure not marked -- can retry */
    return undefined;
  }
}
