# 合鸣功能缺口清单

> 2026-10-04 电脑端会话产出。G1/G2/G3 已于同日修复（见文末「修复记录」）。
> 排序依据是**用户能不能用**（能否触达、点了会怎样），不是代码量。

## 一、今天新挂载的六个路由：端到端通了吗

| 路由 | 前端调用方 | 状态 |
|---|---|---|
| `/api/tokens` | TokenUsagePage.tsx | ✅ 已接，今日刚 token 化 + 有 4 个测试 |
| `/api/e2e` | lib/e2e.ts（1:1 私聊加密） | ✅ 已接，X3DH 流程完整 |
| `/api/reactions` | ReactionBar.tsx:27,30 | ✅ 已接（我一度误判为零调用，已核实） |
| `/api/groups` | GroupMembersPage / GroupAnnouncementPage | ⚠️ **页面存在但到不了**（见缺口 G1） |
| `/api/user-plugins` | 桌面端零调用；移动端 api.ts 有 6 处 | ⚠️ 桌面端无入口，移动端刚补齐待验证 |
| `/api/pairs` | 桌面端零调用；移动端 api.ts 有 4 处 | ⚠️ 同上 |

**结论**：六个路由的服务端与客户端方法都已就位，但其中三者的**界面可达性**有问题。

## 二、按「用户能不能用」排序的缺口

### G1｜群成员管理页与群公告页：路由存在，但没有任何入口 【P0】

| 项 | 内容 |
|---|---|
| 用户视角表现 | 想管理群成员或发群公告 → 界面上找不到入口。侧栏八项（看板/工作流/归档处/联系人/记忆/功能/Token用量/设置）里没有；群聊设置弹窗（GroupSettingsDialog）里也没有跳转链接 |
| 技术根因 | `App.tsx:327-328`（及 478-479 的本地模式分支）注册了 `/group-members` 与 `/group-announcement` 路由，但全仓库搜索 `GroupMembersPage`/`GroupAnnouncementPage` **只有 App.tsx 的 import 与 Route 声明，没有任何 `<Link>`/`navigate()` 指向它们** |
| 连带影响 | 这两页调用的正是今天新挂载的 `/api/groups/*`。**服务端刚补完、路由侧复核了角色权限、加了 9 个测试——但用户点不到，等于没上线** |
| 工作量 | 小（约 0.5 天）。需确认页面读 convId 的方式（useParams 还是 query），在群设置弹窗或聊天头部加入口 |
| 备注 | 这两个页面今天才由审测/移动端补齐，属「后端通了但 UI 没入口」的典型 |

### G2｜AgentsPage（智能体管理）571 行，无导航入口 【P0】

| 项 | 内容 |
|---|---|
| 用户视角表现 | 想新增/编辑/启用智能体 → 侧栏找不到「智能体」入口 |
| 技术根因 | `App.tsx` 有 `path="/agents"` 路由与 lazy import，但 `NAV_ITEMS` 八项里没有 `/agents`；全仓库搜 `navigate("/agents")` 与 `to="/agents"` **零命中**（只有 `/agents` 这个 API 路径的调用，与页面路由无关） |
| 连带影响 | 这是**创建智能体的唯一界面**。571 行的功能页完全不可达，等于用户无法新增 agent |
| 工作量 | 极小（约 0.5 小时）：NAV_ITEMS 加一项即可 |

### G3｜assistant（产品助手）：路由未挂载，UI 已做好 【P1】

| 项 | 内容 |
|---|---|
| 用户视角表现 | 侧栏底部有「产品助手」按钮（App.tsx:399 区域），点击后前端会调 `/api/assistant/status` 与 `/api/assistant/ask`——**但这两个路由今天没挂载**，所以请求 404，面板打不开内容 |
| 技术根因 | `assistantRouter` 已写好且归属 bug 已修（a12b220：owner 从字面量 "assistant" 改为 `req.user?.id`），但 `app.ts` 未挂载 |
| 前置 | 无技术障碍。复核结论：assistant 不持跨用户数据，修复归属后无越权面。**只需挂载 + 起服务实测** |
| 工作量 | 极小：app.ts 加两行。挂载前建议确认 AssistantPanel 在 404 时的降级表现（是否白屏） |

### G4｜org（组织与权限）：挂载前需先修两个缺陷 【P1】

| 项 | 内容 |
|---|---|
| 用户视角表现 | 目前无 org 入口，属「已实现未上线」 |
| 技术根因（1） | `org.ts:90` 的路径 hack `r.patch("/../../users/:id")`——实测可利用：正常客户端 URL 规范化后 404，只有手写未规范化原始请求能命中 |
| 技术根因（2） | `:98-100` 注释自认「简化实现：先读目标当前角色；完整实现需读 DB」——实际不校验目标当前角色，admin 可把 owner 降级 |
| 前置 | 两项都需修：① 改为 `r.patch("/users/:id")`；② 实现「不能操作同级或更高」需连 DB 查目标角色 |
| 工作量 | 中（1-2 天）：修路径简单，补权限实现需新增 store 查询 |
| 备注 | 已提交 b475408 记录当前行为的基线测试（5 个用例），修复时用它对照 |

### G5｜出包后 P0：桌面端 user-plugins / pairs 无界面入口 【P1】

| 项 | 内容 |
|---|---|
| 用户视角表现 | 移动端刚补齐 9 个 API 方法，但桌面端 web 前端对 `/api/user-plugins` 与 `/api/pairs` **零调用**——「功能」页（PluginsPage，导航里有）与「设备配对页」在桌面端是否可用需确认 |
| 技术根因 | 我 grep 桌面端 web 全目录，`user-plugins` 与 `pairs` 的 API 调用零命中；PluginsPage 走的是别的路径 |
| 工作量 | 待确认。若 PluginsPage 已有等价功能则只需接线；若桌面端确实缺页面则需新建 |
| 建议 | 出包前在桌面端实际点一遍「功能」页与设备配对入口，确认可用 |

### G6｜组内权限的 UI 反馈缺失 【P2】

| 项 | 内容 |
|---|---|
| 用户视角表现 | 普通成员进群设置，改公告/入群方式会收到 403 错误提示（技术上是正确的），但界面上没有「你没有权限」的说明，只弹错误 |
| 技术根因 | GroupMembersPage 直接 await api 调用，失败走统一错误处理 |
| 工作量 | 小。属体验优化，不阻塞出包 |

## 三、任务二：ensemble-cloud / local 引用核实

**结论：构建与部署配置零引用，但有 3 处描述需要更新。**

我扩大了 grep 范围到 Dockerfile、yml/yaml、json、sh、bat、ps1（你只 grep 了代码 import）：

| 类别 | 结果 |
|---|---|
| Dockerfile / CI / 部署脚本 / 启动脚本 | **零引用** ✅ |
| 代码 import | **零引用** ✅ |
| `git ls-files ensemble-cloud ensemble-local` | 仍剩 **2 个文件**：`ensemble-cloud/start.bat`、`ensemble-local/start.bat` |

**关于残留的 2 个 start.bat**——它们不是死代码，是**用户可见的启动入口**：
```
ensemble-cloud/start.bat → call "%~dp0..\desktop\launch-desktop.bat" cloud
ensemble-local/start.bat → call "%~dp0..\desktop\launch-desktop.bat" local
```
注释明确写「已改为启动原生桌面版（Electron）」。**若删掉，Windows 用户双击这两个 bat 就打不开应用。**
分析文档 2026-09-05:78 当年的建议正是「删除 packages/ 只留 start.bat」——审测这次删的正是 packages/ 部分，符合原建议。

**需要更新的 3 处描述**：
| 位置 | 现状 | 建议 |
|---|---|---|
| `README.md:95` | 表格写「本地版 \| `ensemble-local/` \| 完全离线运行 \| `合鸣.bat` → 本地版」 | 与实际不符（本地版实际是 Electron 桌面端），建议核对后更新 |
| `CHANGELOG.md:92` | 「创建 `ensemble-local/` 和 `ensemble-cloud/` 目录」 | 历史记录，不建议改（属变更日志） |
| `docs/技术调研/*.md` | 多篇引用 `ensemble-cloud/packages/server/src/...` 的行号 | 这些路径已不存在，调研文档的引用会误导后来者，建议加一句「路径已于 2026-10-04 移除，实际位置为 desktop/packages/server」 |

## 四、给统筹的建议

**出包前必须解决**：G1、G2（都是「功能做好了但用户点不到」，且工作量都在 1 小时内）
**建议一并解决**：G3（挂载 assistant，一两行）
**可延后**：G4（org 涉及权限设计，建议独立排期）、G6（体验优化）

G1/G2 的共性值得记：**两处都不是「没做」，而是「做完了没接上」**——
路由、页面、API 都在，只差一个入口。这类缺口测试与 typecheck 都发现不了
（今天 223 个测试全绿、四个包的 typecheck 全过，这两处依然存在）。
## 修复记录（2026-10-04）

| 缺口 | 修复 | 验证 |
|---|---|---|
| G1 群成员/群公告页无入口 | `GroupSettingsDialog.tsx` 群信息区加两个按钮，用 `?convId=` 直达（与两页的读取方式一致） | 实测 `/group-members?convId=x` 渲染出「群成员（0）」，页面可达 |
| G2 AgentsPage 无导航入口 | `App.tsx` 的 `NAV_ITEMS` 加 `{ to: "/agents", label: "智能体", icon: Bot }`，置于看板之后 | 实测侧栏出现「智能体」，点击后到达 `/agents`，页面渲染出「+ 新建 Agent」 |
| G3 assistant 路由未挂载 | `app.ts` 加 import 与 `app.use("/api/assistant", ...)`，位于 apiAuth 与写限流之后 | typecheck 四包全绿；UI 入口本已存在（侧栏「产品助手」按钮 + AssistantPanel） |

G1/G2 属**可达性问题**，typecheck 与 223 个测试都发现不了——修完后靠起 dev server
实际点击验证，这是统筹强调的验收方式。
