/**
 * Shared singleton set tracking which run-ids have already had their
 * historical events loaded into the store.  Used by both DashboardPage
 * and WorkflowsPage so navigating between pages does not re-fetch the
 * same run.
 */
export const historyLoaded = new Set<string>();
