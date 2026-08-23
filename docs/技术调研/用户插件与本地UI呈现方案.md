# 用户自定义插件与本地 UI 呈现方案

> 编制日期：2026-08-22（第七轮，深化《合鸣功能插件系统方案》留白的两个问题：①用户如何自己装插件；②插件功能如何在客户端 UI 直接展示）
> 现状核实（代码）：mobile 无 WebView 依赖（Capacitor 已在栈内，可加 react-native-webview）；`MessageAttachment` 是 image/video/file/audio 四类固定枚举（shared/src/types/task.ts:105）；聊天内无任何动态卡片机制

## 一、要打通的完整链路

```
用户在设置页「插件市场」浏览 → 一键安装 → 服务端 PluginHost 装载
    → 插件贡献的能力自动出现在三处本地 UI：
        ① 聊天流里的富卡片（投票卡/日历卡/订单卡…）
        ② 输入栏 + 号菜单里的插件入口
        ③ 会话/工作台页的插件面板
    → 卸载即全部消失
```

难点只在最后一环：**服务端插件的能力如何在 mobile/web/desktop 三端"长出 UI"**。三端技术栈不同、发版节奏不同，不可能要求每个插件都写三份原生代码。

## 二、核心决策：三层 UI 呈现体系（按能力递进）

### 第 1 层：声明式卡片（覆盖 80% 场景，零代码渲染）

插件不写前端代码，只输出**结构化数据**，客户端用内置卡片模板渲染：

```jsonc
// 插件通过 chat/message 或 REST 发出的结构化消息
{
  "cardType": "poll",                    // 客户端按此选模板
  "cardVersion": 1,
  "state": { "question": "周五团建去哪", "options": [...], "votes": {...} },
  "actions": [                           // 客户端渲染为按钮
    { "id": "vote", "label": "投票", "style": "primary",
      "endpoint": "/api/plugins/poll/vote", "payload": {"optionId": "..."} }
  ]
}
```

- **协议扩展点已存在**：`MessageAttachment.type` 加 `"plugin-card"` 变体（或新增顶层 `card` 字段），三端的附件渲染分支各加一个 case。
- **内置模板库**放 shared 包（web 用 React 组件、mobile 用 RN 组件，同构 props）：第一版做 5 个万能模板——**表单卡 / 列表卡 / 统计卡 / 进度卡 / 图文卡**。投票=列表卡+actions，日程=表单卡……绝大多数插件够用。
- actions 点击 = 带 token 的 REST 调用 → 插件路由处理 → 返回新 state → 卡片原位更新（走现有 WS 广播）。安全模型清晰：UI 永远只是数据的镜子，动作永远走受控 API。

### 第 2 层：Web 片段沙箱（长尾场景，一次开发三端复用）

内置模板装不下时，插件提供 **HTML/CSS/JS 片段**，客户端在 WebView 里渲染：

- web/desktop：iframe sandbox（`allow-scripts`，postMessage 桥）；
- mobile：`react-native-webview`（需新增依赖，Capacitor 栈内常规操作）+ injectedJavaScript 注入桥；
- **桥协议只有五个方法**：`getState / dispatchAction / resize / openUrl / toast`——片段拿不到 cookie/token/原生 API，动作同样必须经主应用转发到插件路由；
- CSP 锁死外链资源，片段由服务器签名下发（防篡改）。
- 这是 Electron/钉钉/飞书卡片验证过的路线：声明式为主、WebView 兜底。

### 第 3 层：原生插槽（官方一等公民插件专用）

输入栏 + 号菜单、侧栏入口这类**宿主级交互位**不走前两层——由 manifest 的 `ui.slot` 声明，客户端为白名单插件预置原生组件（如投票的"发起投票"按钮）。保持克制：只有官方插件能占原生位，第三方一律走 1/2 层。

## 三、"用户自定义安装"闭环设计

### 3.1 安装来源与信任分级

| 级别 | 来源 | 能力上限 | 审批 |
|---|---|---|---|
| T0 内置 | 随 server 分发的 plugins/ 目录 | 全部 contributes | 无需 |
| T1 市场 | 插件市场 URL（管理员配置的白名单源） | 声明式卡片 + Web 片段 + 定时/事件 | **管理员确认弹窗展示权限清单** |
| T2 本地开发 | 用户拖入目录/zip | 同 T1 | 同 T1 |

第一期不做进程外沙箱，所以 T1/T2 的边界靠三件事守：contributes 清单即权限（超清单调用直接拒绝）、KV/凭据命名空间隔离（已有设计）、waterfall 超时熔断。**市场分发格式直接用 shadcn registry-item schema 思路**（第五轮调研结论）：tarball + manifest + 内容哈希，CLI 与设置页共用同一安装接口。

### 3.2 设置页「插件」中心（两端 UI）

- 已装列表：开关（启停=fiber dispose/reload）、权限摘要、存储占用、卸载。
- 市场页：卡片网格（Bento 式，正好用上 UI 调研成果）、版本/评分/所需权限标注、一键安装进度。
- 移动端与桌面端同一套 REST（`/api/plugins/market` 等），仅壳不同。

### 3.3 权限同意流程

安装时弹权限确认（对齐移动端 OS 的运行时权限心智）：
> 「群投票」想要：发送会话消息 ✓ 提供 2 个工具 ✓ 新增 1 个 REST 路由 ✓ 每周定时任务 ✓ 存储 1MB

## 四、数据流示例：投票插件从安装到渲染

1. 用户 A 在设置页市场安装「群投票」→ 管理员确认 → PluginHost 装载，注册 tools/routes/events。
2. A 在群里点 + 号 → 「发起投票」(第 3 层原生入口) → agent 工具或表单卡创建投票。
3. 插件向会话发出 `cardType: "poll"` 结构化消息（第 1 层）→ 三端聊天流渲染列表卡。
4. B 点选项按钮 → `POST /api/plugins/poll/vote`（带 token）→ 插件更新 state 并广播 → **所有人聊天流里该卡片原位刷新票数**。
5. C 点「查看详情」→ 卡片内嵌 Web 片段展开图表（第 2 层）。
6. 管理员卸载插件 → 卡片降级为静态快照文本（历史保留），工具/路由/定时器全部消失。

## 五、实施排期（接在《功能插件系统方案》P4 之后）

| 步骤 | 内容 | 工时 |
|---|---|---|
| U1 | 卡片协议定稿（MessageAttachment 扩展）+ shared 包双端同构模板组件 ×5 | 3 天 |
| U2 | web/desktop 渲染接入（附件分支 + actions 转发器） | 2 天 |
| U3 | mobile 渲染接入 + react-native-webview 引入 + 桥注入 | 3 天 |
| U4 | Web 片段沙箱（iframe/webview 桥五方法 + CSP + 签名） | 3 天 |
| U5 | 插件市场后端（源白名单/tarball 校验/版本管理）+ 设置页市场 UI 双端 | 4 天 |
| U6 | 投票插件改造为完整示范（卡片+片段+原生入口三位一体） | 2 天 |

合计约 **2.5 周**。U1-U3 完成即可支撑纯声明式插件的端到端体验（价值最大的一段）；U5 后才具备"用户自助安装"条件。

## 六、关键风险

- **卡片协议一旦发布就是兼容性包袱**：cardVersion 从第一天带上，模板只加不改；未识别的 cardType 渲染为通用折叠框（永不白屏）。
- **WebView 片段的安全面**：五方法桥之外的一切 postMessage 忽略并记日志；片段源与插件同生命周期，卸载即失效。
- **三端渲染一致性**：模板组件的 props 由 shared 包类型约束，视觉走第六轮 token 单源管线——两套基建在此汇合。
