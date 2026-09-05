# 合鸣 Backend Audit — 2026-09-04

Scope: `desktop/packages/server` (138 TS files) + `desktop/packages/shared` + `shared/` + `relay-server`. Focus: message reliability, route correctness, API contract drift, DB layer, WS hub, concurrency.

All findings verified against current code on branch `claude/clever-bose-949a87` (also reproduced on `main`). Hard evidence:
- `pnpm --filter @ensemble/server typecheck` → **52 errors, fails**.
- `pnpm --filter @ensemble/server test` → **25/193 tests fail, 6/23 files fail**.
- A tsx reproduction against a real SQLite DB confirmed the runtime crashes below.

No real IPs/credentials are present in this file; any external host is `<SERVER_IP>` and any secret is `<SECRET>`.

---

## ⚠️ HEADLINE: a bad merge reverted the entire message-reliability layer

`store.ts` and `db/sqlite.ts` were reverted to **pre-v0.8.3** versions while their callers were kept. Introduced by merge **`f4e02cd`** ("v0.8.1~v0.9.31 全量合并", parent `4074e56`, which deleted 488 lines from these two files) and **still present on `main`** — so the shipped cloud build has this. Commits `d84ca53` (seq/idempotency), `fba820c` (status/edited_at/delivered_at/editChatMessage), `c021aaa` (reactions), `1971e11` (group_members/searchUsers) are all ancestors of HEAD, but only their **callers** survived — the `Store` methods and schema columns they added were reverted.

The server is currently **not buildable via `tsc`** (52 errors) and **not green on tests** (25 failing). The Docker image builds with `esbuild --bundle` (no typecheck), so every broken method call **ships and throws at runtime**. Fixing this revert unblocks the majority of the findings below.

---

## 1. Message reliability (IM core) — the biggest known P0, still fully broken

`[P0] db/sqlite.ts:90-103 — chat_messages has NO seq column`
The table columns are `(id, run_id, job_id, agent_id, role, user_id, content, attachment, reply_to, mentions, deleted, ts)` — no `seq`, no `status`/`edited_at`/`delivered_at`. The documented monotonic sequence number (the project's #1 reliability gap in im-gap-analysis memory) does not exist in the schema. Proven: `store.test.ts` "assigns monotonic seq" fails with `expected undefined to be 1`.

`[P0] orchestration/store.ts:324-326 — createChatMessage returns void (idempotency gone)`
`stmts.createChatMessage` is a plain 12-column `INSERT INTO chat_messages(...)`, and the method returns `void`. But callers treat it as `number | null` and branch on `=== null` for the idempotency-hit path: `engine.ts:393` `if (seq === null) return;` and `conversations.ts:267` are therefore **dead code** (undefined never equals null). A duplicate `clientMsgId` makes the second INSERT throw `UNIQUE constraint failed: chat_messages.id` (reproduced). Fix: `INSERT OR IGNORE` + per-conversation `seq` via a `nextChatSeq` MAX+1 counter; return `number | null`.

`[P0] api/routes/conversations.ts:213 — GET /api/conversations/:id/messages throws every call (500)`
The handler calls `ctx.store.batchGetReactions(...)`, a method that no longer exists (runtime `typeof === undefined`). Every conversation message-page load crashes → **clients cannot read chat history**. Same class: `editChatMessage` (conversations.ts:376, PUT edit) throws; `markDelivered` (below) throws. These are on mounted hot paths with **no HTTP-level test**, so CI never caught them.

`[P0] orchestration/engine.ts:417 — agent broadcast crashes mid-message (assistant reply never rendered)`
`broadcastChatMessage` persists via `createChatMessage` (OK) then at the end calls `this.store.markDelivered([id])` — a removed method → `TypeError`. The function is synchronous and is invoked by the agent loop (`chat.ts:59,77`) and `POST /api/chat`. Because the throw happens at the last statement, the WS broadcast (engine.ts:414) is skipped: agent messages land in the DB but the exception prevents delivery to the UI and breaks the steering/round logic.

`[P0] chat.ts:137,153 + conversations.ts:206-207 — afterSeq silently ignored; reconnect catch-up dead`
Both routes parse `?afterSeq=N` and pass it as a **third argument** to `listChatMessages(runId, userId?, afterSeq)`, but the method signature is `(runId, userId?)` (store.ts:333), so the third arg is dropped. Reproduced: `listChatMessages(r1, undefined, 999)` returns ALL rows. Offline/reconnect incremental pull therefore returns full history; with no `seq` and no `INSERT OR IGNORE`, the client cannot de-dup either. The entire reconnect-catch-up design is inert. (`runs/:id/events` still works — it uses the intact `getRunEvents`.)

`[P1] orchestration/store.ts:335 — listChatMessages ORDER BY ts, not insertion seq`
`ORDER BY ts` sorts on an ISO string, so two messages within the same millisecond, or a client-supplied/edited `ts`, render out of order. Once `seq` is restored, order by `COALESCE(seq, rowid)` (the pre-revert query already did this).

`[P1] api/ws/protocol.ts:29 + engine.ts:401 — chat.message.seq typed number, actually undefined on the wire`
The WS envelope and `RunEvent.chat.message` declare a `seq` field, but engine assigns it the void return → `undefined`; the user-user `sendToUser` envelopes hardcode `seq: 0` (hub.ts:356). Clients keying ordering/dedup on `seq` (mobile `api.ts:171` `ChatMessageRow = ChatMessage & { seq?: number }`) receive 0/undefined for every message.

`[P1] api/auth wiring — dedup exists only as a rate guard, not idempotency`
`dedup.ts` provides a 2s in-memory same-content guard; it does **not** provide per-message idempotency (`clientMsgId`), so a genuine timeout-retry after the window re-inserts a duplicate. True reliability needs the DB-level `INSERT OR IGNORE` described above. Read receipts themselves work (via `conversation_reads.read_ts` + `chat.read` events); delivered receipts do not (`markDelivered`/`delivered_at` reverted).

---

## 2. Route correctness — 9 routers defined but never mounted; clients 404

`app.ts:138-156` mounts 19 routers. These router factories exist but are **never `.use()`-d anywhere** (grep-confirmed across the server):

| Router | File | Mounted? | Client actually calls it? |
|---|---|---|---|
| groupsRouter (join-type / announcement / members / role / kick) | groups.ts | **NO** | mobile `GroupMembersPage.tsx:70,105,121,134`, `GroupAnnouncementPage.tsx:67`; web `GroupMembersPage.tsx` |
| tokensRouter (GET /api/tokens/stats) | tokens.ts | **NO** | mobile `TokenUsagePage.tsx:47` |
| reactionsRouter | reactions.ts | **NO** | web `ReactionBar.tsx` |
| assistantRouter | assistant.ts | **NO** | mobile + web AssistantPanel |
| userSearchRouter (GET /api/users/search) | groups.ts | **NO** | mobile `GroupMembersPage.tsx:96` |
| orgRouter | org.ts | **NO** | (O1 org feature) |
| userPluginsRouter | user-plugins.ts | **NO** | (R4/U1 plugins) |
| pairsRouter | pairs.ts | NO (test-only) | mobile device-link |
| e2eRouter | e2e.ts | NO (test-only) | e2e identity directory |

`[P1] app.ts:138-156 — nine mounted-elsewhere gaps → mobile/web dead 404s`
Mobile Phase-3 group management, the TokenUsage page, reactions, user-search, device pairing and the E2EE key directory all hit unmounted paths and 404 against the current backend. Even after mounting, groups/org/user-plugins/e2e would still crash because their `Store` methods (`getGroupMember`, `listGroupMembers`, `setGroupMemberRole`, `removeGroupMember`, `searchUsers`, `initOrganization`, `listMembers`, `createDepartment`, `upsertE2eIdentity`, `getE2eBundle`, …) were reverted (typecheck `TS2339`).

`[P1] api/routes/memory.ts:36,41 — `fail` not imported (ReferenceError on auth-failure path)`
The file imports only `asyncH, ok` but calls `fail(...)` in the DELETE handler → TS2304 and a runtime `ReferenceError` when an unauthenticated request reaches `DELETE /api/memory/:id`. Fix: import `fail` from `./helpers`.

`[P1] api/routes/assistant.ts + api/routes/memory-pool.ts — path/verb drift vs clients`
Mobile `api.ts:396` posts to `/api/assistant/chat`, but the router defines `/ask`. Memory-delete from clients calls `DELETE /api/memory/:id` (→ `deleteExplicit`), while the pool router's real endpoint is `DELETE /api/memory-pool/explicit/:id`. These drifts mean the endpoints, even if mounted, are named differently from what the clients call.

`[P1] api/routes/upload.ts:80-81 — `ctx.storage` does not exist on AppContext → every upload 500s`
The route uses `await ctx.storage.upload(...)` / `ctx.storage.getSignedUrl(...)`, but `AppContext` (context.ts) has no `storage` field (typecheck: "Property 'storage' does not exist... Did you mean 'store'?"). The `LocalStorageAdapter` in `storage/index.ts` is never instantiated or wired. Upload of chat attachments is fully broken on this tree.

`[P2] List endpoints have no pagination`
`GET /conversations` (conversations.ts:112), `GET /runs` (runs.ts:7), `GET /tasks` (tasks.ts:8), `GET /agents` (agents.ts:29), `GET /memory` (memory.ts) return unbounded full sets. Only `/messages` takes a `limit`, but applies it as `.slice(-limit)` **after** loading every row into memory.

`[P2] Input validation: only tasks.ts uses zod`
`taskInputSchema.safeParse` guards only `POST /api/tasks`. `conversations POST /` trusts `type`/`participantIds`; `groups` validates `role`/`joinType` inline; org/mcp mostly unchecked. `parseAttachment`/`parseReply` (conversations.ts:11,28) silently drop malformed sub-objects with no 400, so bad attachments vanish rather than error.

`[P2] api/routes/org.ts:96 — traversal-style route mount is fragile`
`orgRouter` registers the user-update handler at `r.patch("/../../users/:id", ...)`, a hack to escape the `/api/org` prefix; combined with the `requireRole` middleware applied to the whole router this is brittle. Recommend a dedicated router mounted at the correct path.

`[P2] apiAuth publicPaths only allow GET (app.ts:127)`
`publicPaths: ["/health", "/app-version", "/settings"]` reject non-GET with 405, so `PUT /api/settings` requires a Bearer token even in "public" mode. Correct for writes, but verify every client sends the header for settings writes or it 401/405s.

---

## 3. API contract drift (shared/ vs desktop/packages/shared vs responses)

`[P1] Two divergent "@ensemble/shared" trees exist`
Root `shared/` is consumed only by `relay-server` and `mobile/App.tsx` device-link code; the server and web/mobile API clients use `desktop/packages/shared` (pnpm workspace alias). `shared/src/messages.ts:112-128` ChatMessage has **no** `seq`/`userId`/`status`/`editedAt`/`deliveredAt`/`thumbnailUrl`; `desktop/packages/shared/src/types/task.ts:116-140` ChatMessage has all of them. Root `shared/` also lacks `plan`/`adversarial` TaskInput modes and the `plugin-card` attachment type. If any code ever imports the root package, the ChatMessage shape silently disagrees. Converge to one source of truth.

`[P1] desktop/packages/shared — documented fields the server never returns`
`types/task.ts` declares `ChatMessage.seq/status(1|2|3)/editedAt/deliveredAt` and `Conversation.joinType/version`, but none are populated: `rowToConversation` (store.ts:598) omits `joinType`/`version`; `listChatMessages` (store.ts:337) omits `seq`/`status`/`editedAt`/`deliveredAt`. `mobile/src/services/api.ts:171` already codes against `ChatMessageRow = ChatMessage & { seq?: number }` — the client is built for a server contract that no longer exists on this tree.

`[P2] Response envelope inconsistency`
`helpers.ts` `ok/fail` produce `{ data }` and `{ error: { code, message } }`; mobile unwraps `.data` (`api.ts:376`). Followed by most routes, but **violated** by `memory-pool.ts` (raw `res.json(...)`) and `relay.ts:22,72,74` (`res.json({connected,status})`, `res.json({success,message})`). Clients unwrapping `.data` get `undefined` from those endpoints.

`[P2] Status-code semantics drift`
`reactions.ts:27` returns 200 via `ok()` for a "already exists" no-op; several not-found-ish errors default to `fail()` → 400 rather than 404/409. `workflows POST /` and `providers POST` correctly use 201, but `PUT` returns 200 with no distinguishing body shape. Low priority but inconsistent for any client that branches on status.

---

## 4. DB layer

`[P1] No schema/migration versioning; multiple tables referenced but never created`
`openDb` (sqlite.ts:174) runs `CREATE TABLE IF NOT EXISTS` plus an ad-hoc `PRAGMA table_info`/`ALTER` sequence (`migrateUserColumns`, sqlite.ts:191-295) — no `PRAGMA user_version` migration ledger. Tables that live code needs are absent (reproduced in tests): `user_plugins` and `plugin_kv` (per-user.ts → "no such table: user_plugins"), `device_link_events` (device-link-log.ts:15 → "no such table"), `message_reactions` (reactions.ts), `group_members` (groups.ts), `organizations`/`departments` (org.ts). `privacy.ts:63,140` works around this by inline `CREATE TABLE IF NOT EXISTS` per request — an inconsistent pattern; migrations belong in `sqlite.ts`.

`[P1] Multi-write operations are not transactions`
The user-user message path (`conversations.ts:254-303`) performs `createChatMessage` + `updateConversationMeta` + `incrementUnread` (×N recipients) as separate statements. `createConversation` (conversations.ts:183) writes the conversation then sets the group owner non-atomically. `broadcastChatMessage` (engine.ts:381-398) does createChatMessage + updateConversationMeta + incrementUnread non-atomically. A crash between them (e.g. the markDelivered throw, §1) leaves `unread`/`last_message` inconsistent with the persisted message row. Wrap each logical unit in `BEGIN/COMMIT`.

`[P2] Missing index + unindexable membership query`
There is no index on `conversations.run_id`, yet `getConversationByRunId` (store.ts:396) filters by it on every broadcast → full scan. `listConversations` (store.ts:408) determines membership via `participant_ids LIKE '%"<userId>"%'` on a JSON TEXT blob — unindexable and fragile (can match a substring spanning concatenated ids). Introduce a `conversation_members(conv_id, user_id)` join table.

`[P2] N+1 and O(n)-forever scans`
`tokens/stats` (tokens.ts:14) loads `listRuns()` (unbounded, no user filter) then `getJobs()` per run, building per-day/per-agent maps — grows with total history forever, uncached. Global search (`conversations.ts` `/search`) loops up to 50 conversations, each running `searchChatMessages`; `searchChatMessages` (store.ts:466) uses `content LIKE '%q%'` despite the "FTS5 搜索" commit title — no FTS5 table/index exists. `hydrateJobEvents` (store.ts:257) issues one event query per job.

`[P2] deleteConversation orphans chat_messages`
`deleteConversation` (store.ts:519) removes the conversation and its `conversation_reads`, but leaves the associated `chat_messages` (keyed by `run_id`) behind. `deleteTask` (store.ts:160) correctly cascades chat_messages/run_events/jobs/runs, but the conversation-delete path does not — reaping is inconsistent between the two.

`[P3] PRAGMA ordering`
`journal_mode=WAL` is inside `INIT_SQL` (sqlite.ts:7) but `busy_timeout=5000` is applied afterward (sqlite.ts:183); single-process now, so latent — but set `busy_timeout` before any concurrent access to be safe under multi-process.

---

## 5. WS hub

`[P1] api/ws/hub.ts:476-485 — backpressure silently drops chat.message`
When `ws.bufferedAmount > 4MB`, `flushPending` sends only `run.status`/`run.result`/`run.error`/`job.status` and skips everything else — including `chat.message`. A slow client (mobile on a flaky network) **loses chat messages with no error signal**; and because the seq/afterSeq catch-up that would recover them is also broken (§1), the loss is permanent. Either requeue skipped frames or emit a "refetch" hint so the client reloads by cursor.

`[P1] api/ws/hub.ts:394-411 — offline push double-fires for ntfy tokens`
`sendOfflinePush` first calls `await sendExpoPush(...)` for **every** device with a `pushToken`, then separately calls `sendNtfyPush` for tokens prefixed `ntfy:`. For an ntfy device, the Expo call throws "EXPO_ACCESS_TOKEN not set" (swallowed) — wasting a round-trip and logging an error on each offline message. Branch on the token scheme (ntfy: → only ntfy; otherwise → only Expo) and skip when neither is configured.

`[P2] No dead-socket reaping / half-open leak`
The heartbeat timer (hub.ts:243) sends a server→client `heartbeat`, and a client `ping`→`pong` handler exists (hub.ts:161), but there is no `isAlive` flag toggled by client traffic and no termination of non-responsive peers (the standard ws keepalive-evict pattern). A client that dies without a TCP FIN lingers in `userSockets`/`runSubs`/`wsSubs` until the OS notices. `eventWaiters`, `userSockets`, `runSubs`, `wsSubs` are unbounded and cleaned only on socket `close`; subscribe-without-unsubscribe bursts grow `runSubs`.

`[P2] Config frozen at attach (closure capture)`
`imWs = this.getSettings?.().im?.ws` (hub.ts:102) is read **once at `attach`**, so `pingIntervalS` and `maxPayloadMb` never rebind after a settings change (the interval at hub.ts:248 and the `maxPayload` at hub.ts:107 captured the old values). This is the "config read in constructor" bug class. `BATCH_INTERVAL`/`MAX_BUFFERED` are hardcoded consts (acceptable).

`[P3] auth.kicked clears only the local set`
On multi-device kick (hub.ts:126-137), old sockets are sent `auth.kicked` and closed and `existingSockets.clear()` runs, but `wsUsers`/`wsSubs`/`wsDevices` for the kicked socket are freed only when its `close` fires — a brief window where a closed socket is still enumerated (harmless due to `readyState` guards, but worth tidying).

---

## 6. Concurrency / consistency

`[P1] Unread counting is inconsistent across conversation types`
The user-user path increments per recipient via `incrementUnread(conv.id, pid)` → `conversation_reads` (per-user). But the agent/group path uses `engine.broadcastChatMessage` → `incrementUnread(conv.id)` with **no userId** → increments only the shared `conversations.unread` (store.ts:500). A multi-participant human+agent group therefore bumps one shared counter on every agent reply, not per-user, so badges are wrong for everyone but the owner. The two code paths disagree for the same table.

`[P2] dedup.ts global clock gating`
`cleanup()` (dedup.ts:11) runs at most once per 60s (shared `lastCleanup`), but `isDuplicateMessage` inserts on every cache miss. Between cleanups the `Map` grows with every distinct `user:conv:content[:100]` key — bounded only by ~60s of traffic volume. Content is truncated to 100 chars, so two long messages sharing a 100-char prefix false-positive as duplicates. Low risk but unbounded within the window and semantically wrong on truncation.

`[P2] run_events seq allocation assumes a single process`
`appendRunEvent` (store.ts:300) allocates seq via the in-memory `eventSeqCounters` MAX+1 and `cleanupRunSeqCounters` deletes the entry at run end. Correct single-process (JS is single-threaded so MAX+1 and INSERT can't interleave). But two server instances sharing the same SQLite file would each compute the same next seq. Current deployment is single-instance, so this is latent; guard with a `nextval` table or `BEGIN IMMEDIATE` if multi-process is ever introduced.

`[P3] Several fire-and-forget promises lack rejection guards`
`ensureMessageHandler`/`relayClient.connect`/`mcpManager.reload()` are `void`-ed (relay.ts, context.ts); the maintenance interval catches internally, and route handlers are wrapped by `asyncH`, but the agent-loop call site of `broadcastChatMessage` is synchronous and its exception (see §1 markDelivered) propagates as a 500 out of `POST /api/chat`. Once `seq`/`markDelivered` are restored, confirm no remaining sync throw escapes `broadcastChatMessage`.

---

## Route → has tests? → key gaps

| Route group | Mounted | Tests present | Key correctness gaps |
|---|---|---|---|
| `/api/chat` | yes | none (HTTP) | afterSeq ignored; duplicate clientMsgId → UNIQUE 500; agent reply path throws (markDelivered) so reply never broadcasts |
| `/api/conversations` | yes | none (HTTP) | **messages load throws (batchGetReactions)**; PUT edit throws (editChatMessage); no txn; no list pagination; agent-group unread not per-user |
| `/api/conversations/search` | yes | none | up to 50 convs × LIKE scan; returns counts only, no snippets |
| `/api/runs` | yes | runs.test (events only) | no pagination; `hydrateJobEvents` N+1; cancel has no ownership ACL check |
| `/api/tasks` | yes | none | zod-guarded input (good); rerun returns Run before execute body finishes; delete cascades correctly |
| `/api/agents` | yes | none | no pagination; `/:id/test` waits up to 120s unbounded |
| `/api/groups/*` | **NO** | none | not mounted; all Store methods reverted |
| `/api/users/search` | **NO** | none | not mounted (searchUsers method gone) |
| `/api/tokens/stats` | **NO** | none | not mounted; unbounded full-history scan |
| `/api/reactions/*` | **NO** | none | not mounted; methods + message_reactions table gone |
| `/api/assistant/*` | **NO** | none | not mounted; client calls /chat, router defines /ask |
| `/api/org/*` | **NO** | none | not mounted; all methods gone; `../../users/:id` path hack |
| `/api/upload` | yes | none | `ctx.storage` missing on AppContext → 500 every upload |
| `/api/memory` , `/api/memory-pool` | yes | none | memory.ts `fail` not imported; raw envelope; DELETE target drift (memory vs memory-pool/explicit) |
| `/api/workflows` | yes | none | `saveWorkflow` no zod validation |
| `/api/providers`,`/api/settings` | yes | none | settings public GET-only; apiKey masked (good) |
| `/api/devices`,`/api/privacy`,`/api/discovery`,`/api/relay`,`/api/app-version` | yes | e2e/pairs store-only | device_link_events table missing (pairs); privacy self-creates tables; relay returns raw envelope |
| `/api/pairs`,`/api/e2e` | NO (test-only) | pairs.test, e2e.test | not mounted; methods/tables missing → their own tests fail |

---

## Severity counts

- **P0: 5** — (1) `chat_messages` has no `seq` column; (2) `createChatMessage` returns void → no idempotency, duplicate send → 500; (3) `GET /conversations/:id/messages` throws (`batchGetReactions`); (4) `broadcastChatMessage` throws (`markDelivered`) so agent replies never render; (5) `afterSeq` ignored + WS `seq` undefined → reconnect catch-up dead. Root cause: the `f4e02cd` revert. **The build is currently red (52 type errors, 25/193 failing tests); because Docker ships via esbuild, broken methods throw at runtime.**
- **P1: 11** — nine unmounted routers (mobile/web call → 404/500, listed as one cluster); assistant path drift; memory.ts `fail` undefined; upload.ts `ctx.storage` missing; shared-type divergence; documented-but-absent response fields (seq/status/joinType/version); WS backpressure drops chat.message; offline push double-fire; group/agent unread not per-user; `listChatMessages` ORDER BY ts; CORS accepts any `http://` origin (app.ts:90).
- **P2: 12** — no pagination (conversations/runs/tasks/agents/health-lists); no transactions around multi-write; no migration ledger + missing tables (user_plugins/plugin_kv/device_link_events/reactions/group_members/org); no index on `conversations.run_id`; LIKE-JSON membership scan; N+1 (tokens / global-search / hydrateJobEvents); envelope inconsistency (memory-pool / relay); status-code semantics; deleteConversation orphans chat_messages; dedup window growth + 100-char truncation; heartbeat does not reap dead sockets; imWs config frozen at attach.
- **P3: 4** — dedup truncation false-positive; auth.kicked cleanup race; single-process seq assumption; unguarded fire-and-forget promises.

## Recommended fix order (unblocks the rest)

1. Restore `store.ts` chat-messages section + `db/sqlite.ts` schema to the `fba820c`/`d84ca53`/`c021aaa` versions (`seq` column + `nextChatSeq`, `INSERT OR IGNORE`, 3-arg `listChatMessages`, `batchGetReactions`/`getReactions`/`addReaction`/`removeReaction` + `message_reactions` table, `editChatMessage`, `markDelivered`, `status`/`edited_at`/`delivered_at`), and re-apply the newer `4f53a21` push_token additions that must survive. Fastest path: `git checkout fba820c c021aaa 1971e11 5a4130f -- desktop/packages/server/src/orchestration/store.ts desktop/packages/server/src/db/sqlite.ts` then re-run `pnpm --filter @ensemble/server typecheck`.
2. Mount the 9 orphan routers in `app.ts` (`groups`, `tokens`, `reactions`, `assistant`+`userSearch` from groups.ts, `org`, `user-plugins`, `pairs`, `e2e`) and fix assistant/chat + memory-pool path drift.
3. Wire `ctx.storage` (instantiate `LocalStorageAdapter` in `createAppContext`) and add `fail` to `memory.ts` imports.
4. Add migration ledger + create the missing tables (`user_plugins`, `plugin_kv`, `device_link_events`, `message_reactions`, `group_members`, `organizations`, `departments`) in `sqlite.ts`; wrap multi-write handlers in transactions; add `idx_conversations_run`; fix the CORS allow-any-http rule and the WS backpressure drop + offline-push double-fire.
5. Converge the two `@ensemble/shared` trees.

No secrets disclosed: external hosts written as `<SERVER_IP>`, credentials as `<SECRET>`.
