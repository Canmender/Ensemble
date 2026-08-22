# 合鸣开发记忆

## 项目架构理解

### 核心设计模式
1. **AgentAdapter 统一接口**: 所有 Agent 通过 startTask → AsyncGenerator<AgentEvent> 接入
2. **Hook 驱动循环**: preReasoning → LLM → postReasoning → 工具执行 → postToolResult → postCall
3. **原子组压缩**: 上下文压缩以 assistant+tool_calls+tool_results 为单位，不切断配对
4. **事件先落库再广播**: 保证断线重连不丢帧

### 关键文件位置
- Agent 适配器: `desktop/packages/server/src/adapters/`
- 编排引擎: `desktop/packages/server/src/orchestration/`
- 工具系统: `desktop/packages/server/src/tools/`
- 记忆系统: `desktop/packages/server/src/memory/`
- 前端页面: `desktop/packages/web/src/pages/`
- 移动端页面: `mobile/src/pages/`

### 配置目录
- 本地版: `ensemble-local/config/` 和 `ensemble-local/data/`
- 云端版: `ensemble-cloud/config/` 和 `ensemble-cloud/data/`
- 主开发: `desktop/packages/server/data/`

## 版本管理

### 两个独立版本
- **本地版 (ensemble-local/)**: 完全离线，数据在本机
- **云端版 (ensemble-cloud/)**: 连接云端，数据在服务器

### 启动方式
- 双击 `合鸣.bat` 选择版本
- 或进入对应目录运行 `start.bat`

## 移动端关键记忆

### 版本号管理
- `mobile/app.json` 是唯一版本源
- 构建用 `node scripts/build-release.cjs`
- 不要裸跑 gradlew assembleRelease

### 数据模型
- 1:1 会话在 conversations.participant_ids 存 JSON 数组
- 判断好友必须双方同属任一 direct 会话

### WS 信令
- 入口必须只判断 `!env.event`，不能用 `!env.runId`

## 桌面端关键记忆

### CSP 配置
- 开发模式需要放宽 CSP
- Vite dev server 需要额外 CSP 规则

### 登录流程
- 登录依赖的 API 不能需要认证
- /settings 需要添加到公开路径

### 设备在线
- 从 API 加载实际设备列表
- 不要硬编码设备信息

## 服务器部署

### 云端服务器
- 地址: <SERVER_IP>:8787
- 数据库: Docker 命名卷 /data/ensemble.db
- APK 托管: /data/apk/

### 部署流程
1. SSH 到服务器
2. git fetch + reset
3. docker compose up -d --build
4. 验证 health + 关键端点

## 踩坑记录

### 1. CSP 阻止脚本加载
- 开发模式和生产模式需要不同 CSP
- Vite dev server 需要额外规则

### 2. 登录请求发送到错误服务器
- /settings 需要添加到公开路径
- 登录流程依赖的 API 不能需要认证

### 3. 头像 URL 构造错误
- 相对路径需要代理
- 开发模式和生产模式有差异

### 4. APK 版本错乱
- android/ 是 git-ignored 的 prebuild 产物
- 必须用 build-release.cjs 构建

## 2026-08-19 更新

### 版本分离
- 创建 ensemble-local/ 和 ensemble-cloud/ 两个独立目录
- 使用软链接共享源代码
- 配置和数据完全隔离

### 移动端 v0.9.3
- 毛玻璃 Dock 效果
- AI 助手页面
- 表情直接发送
- 浅灰+白色配色

### 桌面端 v0.8.0
- Token 使用量图表
- 设备在线状态
- 日志换行修复
- 隐私设置位置调整
