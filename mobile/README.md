# 📱 合鸣移动端

合鸣（Ensemble）的手机端应用，支持与桌面端联动，实现远程控制和实时协作。

## ✨ 功能特性

- **设备发现** — 自动发现局域网内的合鸣桌面端（mDNS）
- **任务同步** — 实时同步任务状态和执行结果
- **远程控制** — 通过手机控制桌面端的任务执行
- **实时聊天** — 与 Agent 进行实时对话
- **状态监控** — 查看 Agent 状态和运行日志

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18
- npm 或 yarn
- Expo CLI（`npm install -g expo-cli`）
- 手机安装 Expo Go 应用

### 安装依赖

```bash
cd mobile
npm install
```

### 启动开发服务器

```bash
# 启动 Expo 开发服务器
npm start

# 或者直接在手机上运行
npm run android  # Android
npm run ios      # iOS
```

### 连接桌面端

1. 确保手机和电脑在同一 WiFi 网络
2. 启动桌面端应用
3. 在手机端的「看板」页面会自动发现桌面端
4. 点击连接，或在「设置」页面手动输入 IP 地址

## 📁 项目结构

```
src/
├── App.tsx              # 应用入口
├── components/          # 通用组件
├── pages/              # 页面组件
│   ├── DashboardPage   # 看板页面
│   ├── TasksPage       # 任务列表
│   ├── ChatPage        # 聊天页面
│   ├── AgentsPage      # Agent 列表
│   └── SettingsPage    # 设置页面
├── services/           # 网络服务
│   ├── connection      # WebSocket 连接管理
│   └── discovery       # mDNS 设备发现
├── store/              # 状态管理（Zustand）
│   ├── deviceStore     # 设备连接状态
│   └── taskStore       # 任务数据状态
├── hooks/              # 自定义 Hooks
├── utils/              # 工具函数
└── types/              # 类型定义
```

## 🔌 通信协议

手机端与桌面端通过以下方式通信：

1. **mDNS/Bonjour** — 自动发现同网段设备
2. **WebSocket** — 实时双向数据传输
3. **REST API** — 请求-响应式调用

详细协议请参考 [通信协议文档](../shared/PROTOCOL.md)

## 🛠️ 开发指南

### 添加新页面

1. 在 `src/pages/` 创建新页面组件
2. 在 `src/App.tsx` 中添加路由配置

### 状态管理

使用 Zustand 进行状态管理：

```typescript
import { useTaskStore } from "../store/taskStore";

function MyComponent() {
  const { tasks, addTask } = useTaskStore();
  // ...
}
```

### 网络请求

使用连接服务发送消息：

```typescript
import { connectionService } from "../services/connection";

// 创建任务
connectionService.createTask("我的任务", "single", {
  prompt: "执行某个任务",
});
```

## 📦 构建发布

### 构建 APK（Android）

```bash
expo build:android
```

### 构建 IPA（iOS）

```bash
expo build:ios
```

### 发布到 Expo

```bash
expo publish
```

## 🐛 常见问题

### 无法发现设备

1. 确保手机和电脑在同一 WiFi 网络
2. 检查防火墙是否阻止了 mDNS 广播
3. 尝试在设置页面手动输入 IP 地址

### 连接后断开

1. 检查网络稳定性
2. 确保桌面端应用正在运行
3. 查看日志了解具体错误

## 📄 许可证

MIT
