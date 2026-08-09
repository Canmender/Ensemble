# WebSocket 事件协议

端点：`/ws`（与 HTTP 同端口，Vite 开发代理 `ws://localhost:5173/ws` → `ws://localhost:8787/ws`）。

## Server → Client

每帧为 JSON：

```ts
interface WsEnvelope {
  v: 1;
  ts: number;        // 服务端时间戳
  runId: string;     // 所属运行
  seq: number;       // run 内单调递增序号（用于重连去重/补拉）
  jobId?: string;    // 关联的 job
  event: RunEvent;
}
```

`RunEvent` 类型：

```ts
type RunEvent =
  | { type: "run.status"; status: RunStatus }
  | { type: "job.status"; jobId: string; agentId: string; status: JobStatus }
  | { type: "agent.event"; jobId: string; agentId: string; event: AgentEvent }
  | { type: "chat.message"; jobId: string; agentId: string; content: string }
  | { type: "run.result"; result: string }
  | { type: "run.error"; message: string }
  | { type: "heartbeat" };   // 每 15s
```

`AgentEvent`（归一化，见 `packages/shared/src/types/events.ts`）：

```ts
type AgentEvent =
  | { type: "status"; status: "queued"|"starting"|"running"|"thinking"|"success"|"error"|"cancelled"; detail?: string }
  | { type: "output"; kind: "text"|"thinking"; text: string }
  | { type: "tool_use"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; output: string }
  | { type: "error"; message: string; code?: string }
  | { type: "done"; outcome: "success"|"error"|"cancelled"|"max_turns"; result?: string; usage?: Usage; sessionId?: string }
```

## Client → Server

```ts
type WsClientMsg =
  | { type: "subscribe"; runId: string }
  | { type: "unsubscribe"; runId: string }
  | { type: "cancel"; runId: string };
```

## 断线重连与补拉

1. 客户端记录每个 run 已消费的最大 `seq`。
2. 重连后 `GET /api/runs/:id/events?afterSeq=<maxSeq>` 拉取缺口。
3. 按 `seq` 去重（已处理的帧跳过），再订阅实时流。

## REST 事件历史

```
GET /api/runs/:id/events?afterSeq=0
→ { data: { events: [{ seq, jobId?, event }], lastSeq } }
```
