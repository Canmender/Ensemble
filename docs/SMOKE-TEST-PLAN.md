# 云端冒烟测试方案（设计稿，未实施）

> 2026-10-04 电脑端会话产出。本文件只出方案，不含脚本、未连服务器。
> 依据：D 项测试摸底查出的缺口——仓库内无冒烟脚本、无定时任务，
> 唯一存活检查是 docker-compose.yml:56 的 relay 容器 healthcheck，
> 只覆盖 relay 进程存活、不覆盖任何业务链路。

## 一、现状核实（三条事实）

**1. 现有 healthcheck 是什么**
`docker-compose.yml:56-61`，仅 relay 容器有：
```
test: node -e "fetch('http://localhost:8888/health').then(r=>process.exit(r.ok?0:1))..."
interval: 30s  timeout: 3s  retries: 3  start_period: 5s
```
它探的是 `relay-server/src/index.ts:175` 的 `/health`，返回
`{status, devices, pendingMessages}`。**有效但极窄**：只证明 relay 进程活着。

**2. scripts/ 与 desktop/scripts/ 的运维脚本清单**
- `scripts/`：`backup.sh`（已修 7b9994f）、`backfill-chat-seq.mjs`（一次性）
- `desktop/scripts/`：`build-tokens.mjs`、`bump-version.mjs`、
  `e2e-live-test.mjs`、`e2e-prod-verify.mjs`、`e2e-selftest.mjs`、
  `ensure-server-config.mjs`、`poll-curl-demo.sh`、`publish-desktop.mjs`、`set-owner.mjs`

**3. 已有 E2E 脚本的覆盖范围（重要发现）**
仓库里**已经有**三个 E2E 脚本，但覆盖很窄：
- `e2e-selftest.mjs`：纯离线，不连服务端，测 X3DH 封装逻辑
- `e2e-live-test.mjs`：连本地 server，走 `/api/conversations/:id/messages`
- `e2e-prod-verify.mjs`：连生产 `<host:port>`，但**只测 `/api/e2e/*`**

也就是说：E2E 协议层有现成脚本可复用，但「部署后基本链路可用性」没有任何检查。

## 二、必须活着的业务链路（核对你给的清单）

你列的四条我核实后确认成立，并补充两条你漏的：

| # | 链路 | 端点 | 现有检查 | 为什么必须活 |
|---|---|---|---|---|
| 1 | server HTTP | `/api/health` | ❌ 无 | 移动端与桌面端都靠它判活 |
| 2 | relay 存活 | `:8888/health` | ✅ healthcheck | 唯一有检查的 |
| 3 | E2E 密钥目录 | `/api/e2e/*` | ⚠️ 有脚本非 CI | 今日刚挂载，越权修复刚落地 |
| 4 | 会话消息 | `/api/conversations/:id/messages` | ⚠️ 有脚本连本地 | IM 核心路径 |
| 5 | **WebSocket 连接** | `ws://…/ws` | ❌ 无 | 消息实时到达全靠它 |
| 6 | **登录与会话** | `/api/auth/login` | ❌ 无 | 一切用户态操作的前置 |

补充说明第 5、6 条为何重要：
- WS 挂了但 HTTP 正常，表现为「消息发得出去、收不回来」——最难从日志发现
- 登录挂了表现为「能打开但什么都做不了」，且移动端与桌面端症状不同

## 三、冒烟检查项设计

分三层，成本递增：**L1 无需凭据 → L2 需 token → L3 需真实账号**。

### L1 免凭据层（可在 CI 跑，只需网络可达）
| 检查 | 方法 | 通过判据 | 失败症状 |
|---|---|---|---|
| server 存活 | GET `{BASE}/api/health` | 200 且 `data.status==="ok"` | 移动端/桌面端全连不上 |
| relay 存活 | GET `{BASE_RELAY}/health` | 200 且 `status==="ok"` | 手机无法经中继访问桌面端 |
| E2E 目录可达 | GET `{BASE}/api/e2e/capability/{未注册id}` | 401 或 403（**不是** 404/500） | 路由未挂载或鉴权中间件失效 |

第三条的判据值得说明：期望 401/403 而非 200——因为匿名请求本就不该拿到数据，
若返回 200 说明鉴权被绕过，那比「不通」更危险。

### L2 需 token 层（从环境变量读，绝不硬编码）
| 检查 | 方法 | 通过判据 | 失败症状 |
|---|---|---|---|
| 认证可用 | 用 `SMOKE_TOKEN` 调 `/api/auth/*` | 非 401 | token 过期或认证服务异常 |
| token 用量隔离 | GET `/api/tokens/stats` | 200 且结构含 `total` | 越权修复若回退会暴露他人用量 |
| E2E 属主校验 | 登录后取**自己**的 bundle | 400（拒绝 self-bundle） | 校验失效＝X3DH 设计被破坏 |
| E2E 遍历防护 | 登录后取**无共同会话**者的 bundle | 403 | 同上，且是安全回归 |

### L3 真实账号层（需用户在服务器上执行一次）
| 检查 | 方法 | 通过判据 | 失败症状 |
|---|---|---|---|
| WS 可连 | 连 `ws://…/ws` 持 token | 握手成功 | 消息延迟或不实时 |
| 消息可发可收 | 双探针账号互发一条 | 双方都能读到 | IM 完全不可用 |
| E2E 密文互通 | 复用 `e2e-prod-verify.mjs` | 双向解密成功 | 端到端加密不可用 |

## 四、能否进 CI —— 分三种情况说清

**能在 CI 跑的**：L1 全部。需要一个 `SMOKE_BASE_URL` secret 指向生产域名。
新增 job 形如：
```yaml
smoke:
  runs-on: ubuntu-latest
  needs: [typecheck, test]
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 22 }
    - run: npm i -g wait-on   # 或直接用 node 脚本
    - run: node scripts/smoke.mjs
        env:
          SMOKE_BASE_URL: ${{ secrets.SMOKE_BASE_URL }}
```

**只能手动/定时跑的**：L2 与 L3。
- L2 需要 token，不能进 PR 触发（PR 由外部贡献者提交，泄露风险）。
  建议放**定时任务**（每日 push 到 main 时）+ 手动 dispatch，绝不放 PR 触发。
- L3 需要真实账号且会写数据（发消息），只能在服务器上手动跑，
  且不该频繁跑（会污染真实会话）。

**只能服务器上跑的**：
- L3 全部。CI 的 ubuntu runner 访问不到内网服务，除非生产是对外暴露的。

## 五、失败时的处理建议（设计要点，未实施）

1. **只读优先**：L1/L2 全是 GET，不改任何状态，可在任何时间跑。
2. **退出码语义**：任一检查失败 → 退出码非 0，让 CI 立刻可见（与今天给
   build-tokens 加 throw 同一思路，不静默通过）。
3. **错误信息要含端点与实际返回**，不能只说「检查失败」——
   这与 backup.sh 那条错误信息的写法一致。
4. **区分「服务挂了」与「鉴权失效」**：401/403 集中在鉴权，5xx/连接失败集中在服务。
   两者处置方式完全不同，报错时要分开说。

## 六、待你与用户确认的两点

1. **生产是否有对外可访问的域名**？决定 L1 能否进 CI（若仅内网则需自建 runner）。
2. **L2/L3 的凭据如何提供**？建议只进 secret，不落任何文件。