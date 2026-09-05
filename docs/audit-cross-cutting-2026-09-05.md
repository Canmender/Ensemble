# 合鸣跨切面审计 — 一致性 / 仓库卫生 / 文档真实性 / 配置漂移（2026-09-05）

范围：跨切面一致性、仓库卫生、文档与代码真伪、配置漂移。不修改代码。
基线：分支 `claude/clever-bose-949a87`（HEAD 400b6ed），与 main 的差异仅为未跟踪的 `docs/audit-backend-2026-09-04.md`。
本文件不含任何真实 IP / 凭据；外部主机一律写 `<SERVER_IP>` / `<NTFY_SERVER_IP>`，密钥一律 `<SECRET>`。

---

## 版本一致性总表（用 node JSON.parse 逐个读取，非 grep）

| 文件 | version 字段值 | 备注 |
|---|---|---|
| desktop/package.json（monorepo 根） | **0.8.39** | 落后于 packages/desktop |
| desktop/packages/desktop/package.json | **0.8.42** | 与 README 桌面徽章一致 |
| desktop/packages/server/package.json | **0.7.46** | 最后 bump 于 2026-08-23（3df0570），之后的 08-28/29 功能提交未再 bump |
| desktop/packages/shared/package.json | **0.7.45** | |
| desktop/packages/web/package.json | **0.7.24** | |
| mobile/package.json | **0.9.11** | 最后 bump 2026-08-27（cb3c471，v0.9.11） |
| mobile/app.json → expo.version | **0.9.33**（versionCode 133） | 09c58d7（08-28）设为 0.9.33；比 mobile/package.json 高 22 个版本 |
| relay-server/package.json | **0.1.0** | 创建以来从未 bump |
| shared/package.json（@ensemble/shared-protocol） | **0.1.0** | 从未 bump |
| CHANGELOG.md 顶部条目 | **v0.9.32 / v0.8.42（2026-08-29）** | 无 v0.9.33 条目；08-29 的 ntfy 功能未收录 |
| desktop/CHANGELOG.md 顶部条目 | **0.4.3（2026-08-10）** | 独立第二份 changelog，已与根 CHANGELOG 分叉一个月 |
| README.md 徽章 | Mobile **v0.9.32** / Desktop **v0.8.42** / tests **145 passed** | Mobile 徽章落后 app.json 一个版本；测试数与实际不符（见 A1-1） |

---

## 1. 文档真实性（Docs truthfulness）

**[P1] README.md:9,201 — 测试徽章/正文声称 145 passed，与实际不符**
源码中共 17 个 `.test.ts`、165 处 `it(/test(` 调用；且 docs/audit-backend-2026-09-04.md 实测 `pnpm --filter @ensemble/server test` 为 193 收集 / 25 失败（非绿）。README 各模块用例数清单也与实际不符（如 api/auth 声称 18、实际 23；llm/retry 声称 13、实际 6）。

**[P1] README.md:47,176,182 + CHANGELOG.md:8-14 — 「推送通知（Expo Push）」描述已过期，全库文档无一提及 ntfy**
08-29 提交 4a48d71 把移动端 push token 注册从 Expo Push Token 改为 `ntfy:ensemble-<userId>` topic，52bf8f9 给服务端加了 `sendNtfyPush`。README 三处、CHANGELOG 顶部条目仍只描述 Expo Push 链路；ntfy 在 README/CHANGELOG/desktop/README 中出现次数为 0。

**[P1] ensemble-local/README.md — 整份 README 描述的是已废弃的旧架构**
声称「浏览器打开 http://localhost:5173」「目录含 .env / config/ / data/ / packages→软链接」「内置 llama.cpp 本地推理」——实际 start.bat 已改为拉起 Electron（desktop/launch-desktop.bat），.env/config/data 目录不存在，packages/ 是真实源码拷贝而非软链接，llama.cpp 是 electron-builder.yml:3 注释里的「未使用的遗留 external」。

**[P1] VERSION-MANAGEMENT.md:28-31 + README.md:98-118 — 「仅保留入口脚本，不再承载源码」「packages/ → desktop/ 软链接」均为假**
每个 ensemble-* 目录实际跟踪 12 份真实源码文件（app.ts/sqlite.ts/store.ts/hub.ts/push 等），非软链接。文档承诺的清理从未执行，且由此产生了下面的漂移隐患（见第 4 节）。

**[P0] docs/自建推送方案-ntfy.md:186-190 — 设计文档的安全承诺与实现完全相反**
文档承诺：Topic 随机化（UUID 不可猜测）、发送端 Bearer token、消息不含正文、杀掉 App 也能收。实现：topic=`ensemble-<userId>`（userId 形如 `user_<16hex>`，随 API 响应暴露且永久稳定，可枚举）；`sendNtfyPush` 不带任何 Authorization，服务端也不读 `NTFY_TOKEN`（push.ts:3 只读 NTFY_SERVER）→ ntfy 服务器无鉴权；推送 body 直接携带消息内容（hub.ts:386-390）；移动端是前台 fetch 长轮询（notifications.ts:120+），App 被杀即断，无人实现任何后台通道。三者叠加 = 知道 userId 的任何人可订阅 topic 读取离线推送正文。

**[P2] MOBILE_DEV_MEMORY.md「配置目录」一节 — 指向不存在的目录**
声称本地版/云端版配置在 `ensemble-local/config/`、`ensemble-cloud/config/`、`ensemble-local/data/`；两个目录下只有 packages/、README、start.bat。

**[P2] desktop/README.md:5,50-51 — 徽章仓库名小写 `Canmender/ensemble` 与根 README 的 `Canmender/Ensemble` 冲突；自动更新描述与实现相反**
其中一个仓库名必然是错的（404）。且声称「应用内检测 GitHub Releases 新版本（electron-updater）」——实际 packages/desktop 无 electron-updater 依赖、源码无 autoUpdater 引用，真实方案是自研更新走服务端 `/api/app-version/desktop`（apkDir/desktop.json，云端存储）。

**[P2] mobile/README.md — 描述的是最早的「遥控器」原型**
只提 mDNS 发现/看板/远程控制，页面清单只列 5 个（实际 29 个），完全没有 IM、E2EE、账号登录、云端直连、插件、通话等主线功能，也没提 Expo Push/ntfy。

**[P2] desktop/docs/DEPLOYMENT.md:61 — 架构图声称 nginx `/` → ensemble-server:8787**
nginx/nginx.conf 只定义了 `upstream relay_server { server relay:8888; }`，全部 location 都 proxy 到 relay；主服务 server:8787 从不经过 nginx（安全头/限流对 Web UI 全部无效，见 C-4）。

**[P2] desktop/docs/TECHNICAL.md:27,74 — 把 `shared/`（@ensemble/shared-protocol）描述为「共享协议」**
构建期没有任何包消费它：mobile 的 metro 别名指向 `desktop/packages/shared/src`（mobile/metro.config.js:7-13），relay-server 无此依赖，desktop 用的是 workspace 内的 @ensemble/shared。standalone shared/ 实质是死包，文档仍在为它背书。

**[P2] mobile/AGENTS.md:11 — 引用「docs/mobile-ui-pitfalls.md 第 10 节」，该节不存在**
文档编号从「关键教训总结」（含 13 条教训）直接跳到 `## 13/14/15` 节；worktree 短路径构建的内容只存在于 AGENTS.md 本身，被引用的落点缺失。

**[P2] docs/DEPLOY.md:160-178 — EXPO_ACCESS_TOKEN 的 compose 配置说明与 docker-compose.yml 脱节**
文档明确指示在 compose `server.environment` 加 `EXPO_ACCESS_TOKEN`，当前 docker-compose.yml 没有这一行，服务端（push.ts:2 从 process.env 读）在现部署下拿不到该变量。

**[P2] mobile/app.json:9 `userInterfaceStyle: "light"` 与「全 App 暗色」宣称矛盾**
CHANGELOG v0.9.10 宣称「三态外观 + 全 App 暗色」，但 app.json 把系统 UI 风格钉死为 light，暗色实现依赖应用内自绘主题；系统层（状态栏/对话框）不会跟随，配置与宣称不一致。

**[P3] CHANGELOG.md — v0.9.33 无条目，08-29 ntfy 系列提交（52bf8f9/4a48d71/276ba56）未收录**
app.json 已到 0.9.33，CHANGELOG 顶部停在 v0.9.32；「推送链路换 ntfy」这一行为变更（含移除 Expo token 获取）在更新日志中不可见。

**[P3] desktop/CHANGELOG.md — 冻结在 0.4.3（2026-08-10）**
与根 CHANGELOG.md（v0.9.32）并存两份语义不同的 changelog，桌面端历史在第二份里缺失整整一个月的迭代。

---

## 2. 版本一致性

**[P1] mobile/package.json（0.9.11）vs mobile/app.json（0.9.33）— 同目录两个版本源相差 22 个 patch**
docs/DEPLOY.md 声称「单一版本源 = mobile/app.json」，mobile/package.json 从 08-27 起再未动过。要么按 DEPLOY.md 废掉 package.json 版本号，要么补齐，否则任何读 package.json 的工具（npm/依赖扫描/发布脚本）都会得到错误版本。

**[P1] 08-28/29 的功能提交破坏了「每提交必 bump patch」约定**
09c58d7/36f9b48/250edc4/e2f20aa/52bf8f9/4a48d71/276ba56 及两个 merge 共 8+ 个含功能代码的提交，除 app.json（09c58d7 顺带 0.9.33）外没有任何 package.json bump：server 0.7.46 停在 08-23，web/shared 更早。版本号已不能追踪迭代数。

**[P2] desktop 根 package.json 0.8.39 vs packages/desktop 0.8.42 — bump-version.mjs 存在但未执行**
desktop/scripts/bump-version.mjs 的注释明说「v0.8.17~0.8.29 手工 sed 只改 packages/desktop，根包漂移两周」——08-27 的 4074e56（bump 0.8.42）又只改了 packages/desktop 一个文件，根包再次停在 0.8.39。

**[P2] README.md 徽章：Mobile v0.9.32 落后 app.json 0.9.33；Desktop v0.8.42 只与 packages/desktop 对齐**
徽章无单一事实来源，三处（徽章/CHANGELOG/package.json）各说各话。

**[P3] relay-server 与 shared-protocol 永久 0.1.0**
relay 自 8689b6c 创建以来 version 未变；版本规则对这两个包事实上不生效。

---

## 3. 配置 / compose 漂移

**[P1] relay 端口三方打架：README/.env.example 用 3001，代码/compose/nginx 用 8888**
relay-server/.env.example:4 `PORT=3001`；relay-server/README.md:102,116,157,192 通篇 3001；而 src/index.ts:30 默认 8888，docker-compose.yml 与 nginx.conf 均按 8888。照 README/.env.example 部署的新人会把 relay 起在 3001，而 nginx 指向 8888 → 502。

**[P1] .env.example 缺 compose 实际消费的全部关键变量**
docker-compose.yml 读取：`ENSEMBLE_PORT`、`RELAY_URL`、`RELAY_AUTH_KEY`、`CLOUD_HOST`、`NTFY_SERVER`（另有 RELAY_PORT/HTTP_PORT/HTTPS_PORT 已覆盖）。.env.example 一个都没写（也不含 EXPO_ACCESS_TOKEN、NTFY_TOKEN）。「两份式」约定里的 example 文件失去示范作用，部署者只能翻 DEPLOY.md 拼凑。

**[P1] EXPO_ACCESS_TOKEN 在当前 compose 下永远不会进容器**
compose 的 `server.environment` 白名单里没有它，docker compose 也不会把宿主 .env 自动注入容器环境；docs/DEPLOY.md 的加法说明未落回文件。现部署中 Expo 推送发送时抛 "EXPO_ACCESS_TOKEN not set"（被 try/catch 吞成 warn）。

**[P2] nginx 配置与 compose/文档三重不一致：不代理 server、HTTP 80 上发 HSTS、暴露 443 却无 TLS 配置**
nginx.conf 只有 relay 上游；`Strict-Transport-Security` 头出现在纯 HTTP :80 的 server 块（对纯 HTTP 无意义且误导）；compose 暴露 `${HTTPS_PORT:-443}`、nginx/ssl 目录被只读挂载但仓库中不存在，conf 里也没有任何 443/ssl server 块——「域名 HTTPS 就绪」（README:47）目前无实现路径。

**[P2] relay-server/Dockerfile:16-17 — 镜像级 HEALTHCHECK 用 curl，而 node:20-slim 无 curl**
docker-compose.yml:56 注释自己承认「node:20-slim 无 curl」并改用 node fetch 探活。compose 运行时覆盖了 healthcheck，但 CI/单独 `docker run` 出来的镜像健康检查恒为 unhealthy，问题被静音。

**[P2] docker-compose.prod.yml 只加固 relay，server 无任何生产覆盖**
relay 拿到日志轮转/限流/资源限制；server（主服务，含 LLM 调用、SQLite）没有 memory 限制、没有 logging max-size——生产配置覆盖不对称。

**[P2] scripts/backup.sh — DB 路径错误，备份链路实际不可用**
`DB_PATH="/data/ensemble-data/ensemble.db"`：容器内真实路径是 `/data/ensemble.db`（compose DB_PATH）；宿主机上 Docker 命名卷不在 `/data/ensemble-data`。脚本需要宿主 sqlite3 二进制（容器注释明说容器里没有）。CHANGELOG:15「SQLite PRAGMA 优化 + 自动备份脚本」把坏脚本当特性宣传。

**[P2] NTFY_TOKEN 只存在于设计文档，代码/配置从未实现**
docs/自建推送方案-ntfy.md:88,99-100 设计了 `NTFY_TOKEN` + Bearer 头；push.ts 的 sendNtfyPush 无 Authorization 头，.env.example/docker-compose.yml 均无 NTFY_TOKEN。与 A1-11 叠加构成无鉴权推送面。

**[P3] compose `version: "3.8"` 已废弃**
docs/DEPLOY.md:139 自己记录了该 warning 与修法（删掉该行），但文件未改。

**[P3] 服务端环境变量读取风格不统一**
NTFY_SERVER / EXPO_ACCESS_TOKEN 在 push.ts 里直接 `process.env` 读取，绕过了 ServerEnv 接口（config/env.ts 集中声明的 PORT/DB_PATH/RELAY_* 等）——新增环境变量无单一登记处，漂移检测更难。

---

## 4. 脚手架重复：ensemble-cloud / ensemble-local 到底是什么

**它们是什么**：历史上是 local/cloud 两套「变体目录」（各自持有一份源码拷贝）。v0.8.2 起架构改为统一从 desktop/ 启动原生 Electron，VERSION-MANAGEMENT.md 与两个 start.bat 注释都宣称这两个目录已降级为「入口脚本目录，不再承载源码与运行时数据」。

**实际状态**：每个目录仍跟踪 12 份真实源码文件（server 的 app/context/sqlite/store/hub/devices/push + shared 的类型与 index），是拷贝不是软链接；无 package.json、无 tsconfig、不参与任何构建/CI/Docker/启动链（desktop/launch-desktop.bat、desktop/Dockerfile、CI、compose 均不引用 ensemble-*）。

**漂移实测（与 desktop/packages 对应文件 diff 行数）**：
- `api/ws/hub.ts`：**62 行落后**（缺 AppSettings.im.ws 配置链、缺 ntfy 推送分支）
- `push/push.ts`：**20 行落后**（完全没有 sendNtfyPush）
- `push/index.ts`：4 行落后；`shared/src/index.ts`：缺 `export * from "./types/org"`
- devices.ts / app.ts / context.ts / db/sqlite.ts / orchestration/store.ts：当前 0 差异（但与 desktop 同样携带后端审计发现的「被坏合并回退的 store/sqlite」状态）

**漂移速度证据**：08-28 的 09c58d7 特意给两份拷贝同步了推送代码；24 小时后 08-29 的 ntfy 提交（52bf8f9/4a48d71/276ba56）只改了 desktop —— 手工同步在同一天内就失效了。

**结论（明确回答）**：ensemble-cloud / ensemble-local 不是安全的入口目录，而是**活跃的漂移隐患**。它们不被任何构建路径消费，因此其腐烂对工具完全不可见；一旦有人按 README「软链接」的假描述去改这些文件，改动会静默丢失。唯一用途是 start.bat → launch-desktop.bat 一行转发。安全做法：删除两目录下的 packages/（12+12 文件），只留 start.bat（cloud 侧顺手补一个与 local 对称的 README）。它们还把 desktop 当前的坏合并产物（回退版 sqlite.ts/store.ts）原样复制了一份，扩大了 P0 修复时的波及面。

**[P2] ensemble-cloud 没有 README（ensemble-local 有）**
同一模式的两个目录文档不对称；cloud 目录对新人完全自描述缺失。

---

## 5. 仓库卫生

**[P0] mobile/src/services/notifications.ts:29 — 真实服务器 IP 硬编码进源码：`const NTFY_SERVER = "<NTFY_SERVER_IP>"`**
违反隐私红线与两份式约定（server.config.example.js 机制就在旁边，却未使用）；且引入该行的提交 4a48d71 的 commit message 里也明文写了同一 IP（git 历史永久泄漏）。需要改 config + 轮换服务器 + 清史（或接受历史泄漏并记录）。

**[P0] CHANGELOG.md:199 — 真实 coturn 服务器 IP 写进更新日志：`已部署 coturn 到云服务器 <SERVER_IP>（UDP/TCP 3478，中继 49160-49200）`**
公开仓库的 CHANGELOG 直接暴露生产服务器地址 + 端口策略（TURN 中继段），等于给攻击者一张网络图。同一条目自己都说「凭据不入库」，但 IP 本身也在红线内。

**[P1] desktop/packages/server/src/app.test.ts:13,21 — 真实 IP 作为测试夹具**
`isAllowedOrigin("http://<SERVER_IP>:8787", ...)`——测试文件入 git，同一真实地址第三处出现。

**[P1] .claude/worktrees/ecstatic-stonebraker-227b18/ — 别的 worktree 的 4 个源文件被提交进了主仓库**
提交 f0f4c90「fix: 4个P0问题修复」的所有 diff 都落在 `.claude/worktrees/...` 路径下：真正的 P0 修复只进了拷贝（例如 `newArchEnabled=false` 只存在于该 stale gradle.properties 拷贝；真实 mobile/app.json 中无 newArchEnabled，mobile/android 又是 gitignored prebuild 产物）→ Android 16 白屏修复从未落到可跟踪状态。这 4 个文件应删，其中 gradle.properties 的 newArchEnabled 需要找正确载体（app.json gradleProperties 插件或 prebuild 后检查）重新落地。

**[P2] .claude/settings.local.json 被跟踪提交**
机器本地权限配置，惯例应 gitignore（`.claude/settings.local.json`），当前内容包括历史 `git commit`/`ssh` 权限白名单。

**[P2] desktop/packages/shared/package-lock.json — pnpm workspace 包里混入 npm lockfile**
desktop 是 pnpm workspace（CI 用 `pnpm install --frozen-lockfile` 只认根 pnpm-lock.yaml），这个 npm lockfile 是无主流杂物，还会让 `npm install` 在包内产生第二套依赖事实。

**[P2] 移动端出包缺少 desktop 那样的 server.config.js 门禁**
desktop 有 ensure-server-config.mjs 硬失败门禁；mobile/build-release.cjs 无任何检查——开发者本地缺 server.config.js 时会**静默**打出指向 `YOUR_SERVER_HOST` 的 APK（connection.ts:47 占位回退），且 build-release 流程要求手工拷配置到短路径目录，双重人为环节。

**[P3] .gitignore 存在失效条目且缺新条目**
`IM/`、`image/`、`TencentDB-Agent-Memory/` 引用的目录不存在（历史遗留噪音）；同时没有忽略 `.claude/worktrees/`（正是 H-4 事故的根源）和 `.claude/settings.local.json`。

**[P3] mobile/package.json 含 3 个未使用的 @capacitor 依赖**
RN 应用里 `@capacitor/android|cli|core` 无任何 import（src/ 零引用），拖大安装树、误导依赖审计。

**[P3] docs/audit-backend-2026-09-04.md 当前为未跟踪状态**
审计底稿游离在版本控制外，丢失/分叉风险；确定要保留就应入库。

**[P3] 无 node_modules/构建产物入库（验证通过）**
git ls-files 扫描未发现 node_modules、dist、.env、日志、APK、密钥文件；最大跟踪文件为 mobile/package-lock 334KB 与两张 225KB PNG，可接受。mobile/server.config.js、getui.config.js 的 ignore 规则有效（check-ignore 验证）。

---

## 6. CI 健康（.github/workflows/ci.yml，唯一 workflow）

**[P1] CI 完全没有 mobile 任务**
mobile/package.json 有 `typecheck` 脚本，但 CI 的四个 job（typecheck/test/build/docker）没有任何一步 install 或编译 mobile。移动端是四大端中唯一零 CI 覆盖的（它同时是版本号最漂移、唯一硬编码 IP 的端）。

**[P1] CI 完全没有 relay-server 的 typecheck/test 任务**
relay 有现成的 `typecheck` 与 `test`（tsc && node --test，9 个用例，README:202 还在引用），CI 只在 `docker` job 里 build 镜像。relay 的协议是五份拷贝中最关键的对端，却无回归防线。

**[P2] docker job 只是 relay 镜像冒烟：不 push、不 run；真正的部署镜像 desktop/Dockerfile 从不在 CI 构建**
部署用的 server 镜像（esbuild 打包绕过 tsc）在 CI 零覆盖——而后端审计实测 server tsc 已有 52 错误，意味着「CI 绿」与「Docker 能出能跑」之间是断开的；docker job 的 `docker build ./relay-server` 也不会暴露 C-5 的 healthcheck 问题。

**[P3] build job 覆盖 server build + web build，但不含 Electron 壳**
`pnpm --filter @ensemble/desktop build`（main/preload 的 esbuild）不在 CI，桌面壳的构建回归依赖开发者本机。

---

## 严重度统计

| 严重度 | 数量 |
|---|---|
| P0 | 3 |
| P1 | 14 |
| P2 | 21 |
| P3 | 9 |
| **合计** | **47** |

P0 清单：mobile notifications.ts 硬编码真实 IP；CHANGELOG 泄漏生产 coturn IP；ntfy 设计承诺（随机 topic/token 鉴权/不含正文/后台可达）与实现四连反。
P1 集中在两处主题：**(a) 「文档说 X、代码是 Y」**（Expo Push 已换 ntfy、ensemble 目录「已清空」实为拷贝、nginx 架构图、测试数、端口 3001/8888）；**(b) 覆盖缺口**（mobile 与 relay 零 CI、EXPO_ACCESS_TOKEN 到不了容器、备份脚本坏路径）。

## 修复优先级建议（不改代码，仅供决策）
1. 三处真实 IP 处理（换号/清史/入库 .gitignore 补丁）——隐私红线。
2. ntfy 无鉴权 + topic 可枚举 + 正文入推送：加 NTFY_TOKEN + 随机 topic + 脱敏预览，或至少先文档标注「仅限自用可信网络」。
3. 删除 ensemble-*/packages/（24 文件），文档改口径；顺带修 H-4 的 stray worktree。
4. 版本号一次性对齐（mobile/package.json、desktop 根包、CHANGELOG 补 0.9.33/ntfy 条目），并把 bump 纳入 deploy-server 命令。
5. .env.example 补齐 compose 变量；EXPO_ACCESS_TOKEN/NTFY_TOKEN 写进 compose；relay 端口文档统一为 8888；backup.sh 路径改为容器内执行。
