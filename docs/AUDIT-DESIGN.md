# Agent 行为审计台 · 设计方案

> 2026-10-04 电脑端会话产出。**本文先于实现**，schema 定下来比改代码贵。
> 目标：把「我们有审批流程，但没有可查询的记录」这个缺口补上，
> 使数据主权这个技术优势具备可验证的证据链。

## 一、为什么需要（背景）

调研判断「审计/审批是玩具与生产力工具的分水岭」。我们的 HITL 侧其实完整：
工具审批（`adapters/builtin/loop.ts`）、5 分钟自动拒绝（`api/ws/hub.ts`）、
风险评分 UI（`web/src/components/ToolConfirmDialog.tsx`）。

**但审批事件从未被记录。** 这条链路的每一环都只在内存里存在。

## 二、核实：当前审批链路实际发生了什么

| 环节 | 现状 | 位置 |
|---|---|---|
| 审批请求发起 | `hub.requestConfirm(runId, tool, args)` 返回 boolean，无留痕 | `hub.ts:530-550` |
| 用户点批准/拒绝 | `resolveConfirm()` resolve 后即丢弃 | `hub.ts:553-559` |
| 超时自动拒绝 | resolve(false)，**连「被自动拒绝」这个事实本身都没记录** | `hub.ts:534-537` |
| 关机清理 | 全部 resolve(false) | `hub.ts:588-592` |
| 风险评分 | **纯前端计算**，服务端拿不到 | `ToolConfirmDialog.tsx:14-18` |
| 存储 | `pendingConfirms` 是内存 Map（`hub.ts:65`），**重启即全部丢失** | — |

### 现有三张表为何都不适合

| 表 | 有什么 | 缺什么 |
|---|---|---|
| `runs`（`sqlite.ts:49-60`） | user_id / 时间 / status / task_title | 无任何审批字段 |
| `jobs`（`sqlite.ts:62+`） | prompt / agent / status / usage | **没有 tool 名字段**——工具调用不在此表 |
| `run_events`（`sqlite.ts:80-88`） | user_id + event_json + ts | 结构最接近，但 `requestConfirm()` **全程未调用 `insertRunEvent`** |

**结论：审批事件从未写入任何表，且三张表都没有它的位置 → 必须新建表，
不是查询视图。**

## 三、表结构

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  ts          TEXT NOT NULL,          -- ISO 时间
  user_id     TEXT NOT NULL,          -- 主体
  action      TEXT NOT NULL,          -- 动作类型，本轮恒为 'tool_confirm'
  run_id      TEXT,                   -- 目标对象：所属 run
  tool        TEXT,                   -- 目标对象：工具名
  args_digest TEXT,                   -- 参数摘要，**不存原文**（见 §4.2）
  decision    TEXT NOT NULL,          -- approve | reject | auto_reject
  reason      TEXT,                   -- auto_reject 的来源：timeout | shutdown
  risk        TEXT,                   -- low | medium | high，**本轮恒为 NULL**（见 §4.1）
  latency_ms  INTEGER,                -- 从请求发出到决定的耗时
  confirm_id  TEXT                    -- 与 WS 侧关联，便于排查
);
CREATE INDEX IF NOT EXISTS idx_audit_ts   ON audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, ts DESC);
```

### 三个设计要点

1. **decision 区分 reject 与 auto_reject**，并用 `reason` 区分自动拒绝的来源
   （`timeout` / `shutdown`）。原因：「用户主动拒绝」与「用户没来得及点」
   在审计上意义完全不同——前者是主动否决，后者是流程超时，混在一起会让
   统计失真，也让排查「为什么 Agent 卡住」变得不可能。

2. **不复用 `run_events`**。语义不同：run_events 是「Agent 执行的业务事件流」，
   audit_log 是「人的授权行为」。混在一起后，「谁批准了什么」与
   「Agent 做了什么」互相污染，查询时难以分离，两者的保留期也不同。

3. **不记录消息内容**（统筹明确的边界）。
   审计要回答的是「谁在什么时候批准了什么动作」，这个元数据足够。

## 四、本轮不做的两项及其依赖关系

> 这一节是本文档的重点。**将来若有人看到 `risk` 列全空，不要以为是 bug。**

### 4.1 `risk` 字段本轮恒为 NULL —— 依赖「评分逻辑移到服务端」

风险评分 `getRiskLevel()` 定义在 **web 端组件**（`ToolConfirmDialog.tsx:14-18`），
规则是按工具名关键词的启发式：

```ts
if (tool.includes("delete") || tool.includes("remove") || tool.includes("destroy")) return "high";
if (tool.includes("write") || tool.includes("edit") || tool.includes("modify")) return "medium";
return "low";
```

WS 载荷 `tool_confirm_request` 只有 `{confirmId, tool, args}`，
**评分结果从不回传服务端**，所以服务端无从知晓风险等级。

挪动它需改 `ToolConfirmDialog` 与 WS 载荷两端，超出审计台范围。**另开任务。**

> ⚠ **由此暴露一个比审计台更严重的问题（已上报，建议单独排期）**：
> **当前的风险评分不可信**——评分发生在客户端，用户改代码即可绕过；
> 且关键词启发式易误判（工具名不含关键词但实际操作危险）。
> 用户看到「高风险」以为是系统判断，实际可能只是工具名恰好没命中关键词。
> **这影响 HITL 整体安全性，不只是审计记录缺失。**

### 4.2 `args` 只存摘要，不存原文 —— 依赖「摘要格式约定」

**理由：用户批准一次文件写入，不等于同意把文件内容存进可查询的日志。**
工具参数里可能含敏感内容（如 `write` 类工具的 args 带文件内容片段），
存原文会与项目对外承诺的数据主权口径冲突。

摘要格式（够回答审计问题，又不泄露内容）：

```
sha256:<hex>;keys=[path,content];len=2048
```

`keys=[path,content]` 能让人知道「他批准了一次写文件操作、涉及 path 与 content」，
但看不出文件里写了什么。

## 五、查询：HTTP 端点 + 桌面端 UI

### 端点

```
GET /api/audit?userId=&runId=&from=&to=&limit=&decision=
```

- **鉴权**：复用现有 `apiAuth`。默认只允许查自己的记录；
  跨用户查询仅限 `role=admin`（该规则待确认，属产品决策）。
- **读限流**：**与写限流分开计数**（审计查询不应占用用户正常的写配额）。
  每分钟每 IP 60 次，超限 429。
  实现方式：`app.ts:51` 的 `createWriteRateLimiter` 已有完整的滑动窗口实现，
  审计路由单独用一个实例，只拦 GET。

> 为什么要读限流：审计查询虽只返回元数据，但可用于**探测「某人何时批准了什么」**，
> 这本身就是信息泄露。现有 `createWriteRateLimiter` 只拦
  `POST/PUT/DELETE`（`app.ts:66`），GET 完全不设防。

### UI

- 桌面端新增「审计」页（`web/src/pages/AuditPage.tsx`）+
  **侧栏 NAV_ITEMS 加入口**（置于「设置」之前）。
- ⚠ **入口必须同步加**。今天刚修完 G1/G2/G3 三个「路由/页面都在但用户点不到」
  的可达性缺口（223 个测试全绿也没拦住）。新页面若只注册路由不加入口，
  会重蹈覆辙。验收时会专门查「能否从侧栏点进去」。

### 移动端

**本轮不做**（按统筹决策）。表建在 server 侧，未来加移动端只读视图
不需要改数据结构。

## 六、数据保留期清理

审计表会无限增长，需清理脚本。**两条硬要求（来自今日教训）：**

1. **必须先 dry-run**：打印将要删除的文件与数量，人工确认后再执行。
   审计数据虽可再生，但误删会让人对「可审计」这件事失去信任。
2. **必须带存在性校验**：`scripts/backup.sh` 刚修出过路径错误
   （备份了一个不存在的库，`7b9994f`），本脚本的路径要独立核实，
   找不到目标表时直接报错退出而非静默成功。
3. 默认保留 90 天。

## 七、实施顺序（待方案确认后执行）

1. `sqlite.ts` 加表与索引（迁移段）
2. `store.ts` 加 `appendAuditLog` 与查询方法
3. `hub.ts` 的三条决策路径（resolve / timeout / close）各写入一条记录
   —— **需要给 `requestConfirm` 加 `userId` 参数**（见下方遗留项）
4. `audit.ts` 路由 + 独立读限流，`app.ts` 挂载
5. 桌面端 `AuditPage` + NAV_ITEMS 入口
6. `scripts/audit-cleanup.sh`（dry-run 优先）
7. 补测试：审批 → 查审计记录能查到（端到端）

## 八、遗留：记录主体 userId 需要改函数签名

`hub.requestConfirm(runId, tool, args)` **当前没有 userId 参数**
（`hub.ts:530`），其包装 `wsAskConfirm`（`context.ts:239-243`）也没有。
审计需要主体，所以这两个签名都要加参数。

这是实施时的必要改动，已在此记录以免遗漏。

## 九、待确认

- 跨用户查询是否开放给 `role=admin`（属产品决策）
- 读限流的配额（当前建议 60 次/分钟，与写限流同量级）
