# 性能优化指南

本文档记录合鸣桌面端的所有性能优化措施、设计决策和维护指南。

## 📊 优化成果总览

| 优化项 | 优化前 | 优化后 | 降幅 | 来源 |
|--------|--------|--------|------|------|
| 首屏 JS | 426 KB (1 文件) | 190 KB (2 文件) | **↓55%** | 路由懒加载 |
| 首屏 gzip | 133 KB | 62 KB | **↓53%** | vendor chunk 拆分 |
| RunPage | 153 KB | 13 KB | **↓92%** | reactflow 动态加载 |
| node_modules | 668 包 | 574 包 | **-94 包** | 死依赖清理 |
| Auto-Compact 阈值 | 50% | 95% | — | 参考 OpenCode |
| SQL 解析 | 每次查询重新 prepare | 启动时一次性 prepare | — | 参考 OpenCode sqlc |

---

## 🏗️ 前端优化

### 1. 路由懒加载

**文件**: `packages/web/src/App.tsx`

所有页面组件使用 `React.lazy()` 动态导入，首屏只加载当前路由的代码：

```tsx
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const AgentsPage = lazy(() => import("./pages/AgentsPage"));
// ... 共 8 个页面

// 使用 Suspense 包裹路由
<Suspense fallback={<PageLoading />}>
  <Routes>
    <Route path="/" element={<DashboardPage />} />
    ...
  </Routes>
</Suspense>
```

**维护指南**:
- 新增页面时，使用 `lazy(() => import("./pages/XxxPage"))` 模式
- 不要将页面组件直接 import，否则会打入主包
- `PageLoading` 组件提供统一的加载骨架屏

### 2. reactflow 动态加载

**文件**: `packages/web/src/pages/RunPage.tsx`

reactflow（~155KB）仅在用户点击"画布"tab 时加载：

```tsx
const WorkflowCanvas = lazy(() =>
  Promise.all([
    import("reactflow"),              // JS 按需加载
    import("reactflow/dist/style.css"), // CSS 同步拆分
  ]).then(([rf]) => ({
    default: function WorkflowCanvasInner({ jobs }) {
      const { ReactFlow, Background, Controls } = rf;
      // ...
    }
  }))
);

// 使用时包裹 Suspense
<Suspense fallback={<Spinner label="加载画布…" />}>
  <WorkflowCanvas jobs={jobs} />
</Suspense>
```

**维护指南**:
- reactflow 更新时，确保 CSS 路径不变（`reactflow/dist/style.css`）
- 如果 reactflow 升级到 v12+，检查 API 变化（`ReactFlow` → `ReactFlowProvider`）
- 画布功能扩展时，保持在 `WorkflowCanvasInner` 内部

### 3. Vite Vendor Chunk 拆分

**文件**: `packages/web/vite.config.ts`

```ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        "vendor-react": ["react", "react-dom", "react-router-dom"],
        "vendor-flow": ["reactflow"],
      },
    },
  },
},
```

**产物结构**:
```
dist/assets/
├─ vendor-react-*.js    163 KB  ← 框架层（长期缓存）
├─ vendor-flow-*.js     155 KB  ← reactflow（按需加载）
├─ index-*.js            26 KB  ← 应用壳 + 导航
├─ RunPage-*.js          13 KB  ← 页面代码（各路由独立）
├─ SettingsPage-*.js     30 KB
├─ DashboardPage-*.js    16 KB
├─ ...
├─ style-*.css          6.9 KB  ← reactflow CSS（按需加载）
└─ index-*.css           36 KB  ← 主 CSS
```

**维护指南**:
- 新增大型依赖时，考虑是否需要加入 `manualChunks`
- 框架依赖（react/react-dom）变更频率低，适合长期缓存
- 业务代码变更时，vendor chunk 的 hash 不变，浏览器可复用缓存

---

## ⚡ Electron 优化

### GPU 渲染标志

**文件**: `packages/desktop/src/main/index.ts`

```ts
// GPU 光栅化：将页面光栅化交给 GPU，减少 CPU 占用
app.commandLine.appendSwitch("enable-gpu-rasterization");
// 零拷贝：GPU 直接渲染到屏幕缓冲区，减少内存拷贝
app.commandLine.appendSwitch("enable-zero-copy");
```

**维护指南**:
- 这些是 Chromium 启动标志，随 Electron 版本更新可能变化
- 如果出现渲染异常，可尝试注释掉这些标志排查
- 参考 [Chromium Switches](https://peter.sh/experiments/chromium-command-line-switches/)

### 后台节流

**文件**: `packages/desktop/src/main/window.ts`

```ts
win.webContents.setBackgroundThrottling(true);
```

窗口最小化/隐藏时降低渲染帧率，节省 CPU/GPU。

---

## 🧠 引擎优化

### Auto-Compact（自动上下文压缩）

**文件**: `packages/server/src/context/manager.ts`

**设计参考**: [OpenCode](https://github.com/opencode-ai/opencode) (Go)

当 token 使用达到上下文窗口 95% 时，自动触发 LLM 摘要压缩：

```ts
compactionThreshold: opts.config.compactionThreshold ?? 0.95, // 95% 触发
```

**压缩策略**:
1. **原子组切分**：`assistant(+tool_calls) + tool_results` 为一组，绝不切断配对
2. **保留最近 N 组**：默认保留最近 8 组原文
3. **LLM 结构化摘要**：压缩中间历史为 `SESSION INTENT / SUMMARY / ARTIFACTS / NEXT STEPS`
4. **overflow 恢复**：`context_length_exceeded` 时极端压缩（system + 摘要 + 末条）

**配置项**（Agent YAML）:
```yaml
context:
  budgetTokens: 80000        # 上下文窗口大小
  compactionThreshold: 0.95  # 压缩触发阈值（0-1）
  keepRecentRawGroups: 8     # 保留最近原文组数
  toolResultOffloadChars: 8000  # 工具结果超过此字符数触发 offload
```

**维护指南**:
- 阈值从 0.5 改为 0.95 是关键优化：过早压缩浪费 LLM 调用，过晚可能 overflow
- 摘要 prompt 在 `buildSummaryPrompt()` 函数中，可按需调整格式
- 如果模型上下文窗口变化（如 200K），调整 `budgetTokens`

### 工具循环恢复

**文件**: `packages/server/src/adapters/builtin/loop.ts`

**设计参考**: [OpenClaw](https://github.com/openclaw/openclaw) (TypeScript)

检测工具调用死循环，自动终止并引导 LLM 换策略：

```ts
// 检测逻辑
const toolLoopState = {
  recentSignatures: [],     // 最近 10 个工具调用签名
  consecutiveDuplicates: 0, // 连续重复次数
  maxConsecutive: 3,        // 阈值：3 次视为循环
};

// 签名 = 工具名 + 参数 JSON
function toolCallSignature(call) {
  return `${call.name}:${JSON.stringify(call.input)}`;
}
```

**触发后行为**:
1. 向前端广播警告消息
2. 注入系统消息：`"请换一种方法或直接给出结论"`
3. 给 LLM 一次机会调整策略
4. 如果再次循环，终止执行

**维护指南**:
- `maxConsecutive` 可调整（默认 3），太低可能误判，太高浪费 token
- 签名使用完整参数 JSON，参数变化不算循环
- 如果有工具确实需要重复调用（如轮询），考虑加入白名单

### Steering 消息注入

**文件**: `packages/server/src/adapters/builtin/loop.ts`, `api/ws/protocol.ts`

**设计参考**: [OpenClaw](https://github.com/openclaw/openclaw) (TypeScript)

用户在 agent 运行中发送消息，注入到下一个迭代检查点：

**WebSocket 协议**:
```json
// 客户端 → 服务端
{ "type": "steer", "runId": "run_xxx", "content": "换个方向" }
```

**数据流**:
```
前端 → WS "steer" → Hub.onClientMessage → Engine.addSteering(runId, content)
  → steeringQueues[runId].push({ content, timestamp })
  → executor.startTask({ steeringQueue: engine.getSteeringQueue(runId) })
  → loop.ts 每次迭代检查 steeringQueue → 注入 ctx.msgs
```

**维护指南**:
- Steering 消息在工具执行前注入（检查点）
- 注入后队列清空，避免重复注入
- 消息格式：`[用户追加] ${content}`
- Run 结束时自动清理 steering 队列

### 预编译 SQL 语句

**文件**: `packages/server/src/orchestration/store.ts`

**设计参考**: [OpenCode](https://github.com/opencode-ai/opencode) sqlc 模式

所有固定 SQL 在构造时一次性 prepare，后续直接 bind+run：

```ts
constructor(private db: DatabaseSync) {
  this.stmts = {
    createTask: db.prepare("INSERT INTO tasks ..."),
    getTask: db.prepare("SELECT * FROM tasks WHERE id = ?"),
    // ...
  };
}

// 使用时直接 bind
createTask(task) {
  this.stmts.createTask.run(task.id, task.title, ...);
}
```

**维护指南**:
- 新增固定查询时，在构造函数中 prepare，在方法中使用 `this.stmts.xxx`
- 动态 SQL（如 `updateRun` 的 SET 子句因 patch 不同而变化）仍需即时 prepare
- 如果 `node:sqlite` API 变化，检查 `prepare().run/get/all` 签名

---

## 🗑️ 依赖清理

### 已移除的死依赖

| 依赖 | 原因 | 影响 |
|------|------|------|
| `@anthropic-ai/claude-agent-sdk` | 从未在源码中 import | -94 包 |
| `uuid` | 已有 `util/id.ts` 的 `newId()` | 减少 bundle |
| `@types/uuid` | uuid 移除后无需类型 | — |

**维护指南**:
- 定期检查 `pnpm why <package>` 确认依赖是否仍在使用
- 新增依赖前，先检查是否有内置替代（如 `node:crypto`）
- `socket.io-client` 目前用于中继服务器连接，非死依赖

---

## 📈 性能监控

### 构建产物检查

```bash
# 构建并查看产物大小
pnpm --filter @ensemble/web build
ls -lh packages/web/dist/assets/*.js

# 检查首屏加载大小
cat packages/web/dist/assets/index-*.js packages/web/dist/assets/vendor-react-*.js | wc -c
```

### 运行时监控

- **DevTools Network**: 验证懒加载是否生效（切换路由时观察新 JS 加载）
- **DevTools Performance**: 检查主线程阻塞时间
- **Electron DevTools**: `win.webContents.openDevTools()` 查看渲染进程

---

## 🔗 参考项目

| 项目 | 语言 | 借鉴内容 |
|------|------|----------|
| [OpenCode](https://github.com/opencode-ai/opencode) | Go | Auto-Compact 阈值、预编译 SQL、PubSub 事件 |
| [OpenClaw](https://github.com/openclaw/openclaw) | TypeScript | 工具循环恢复、Steering 消息、EventStream 模式 |
