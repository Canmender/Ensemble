# 合鸣（Ensemble）— 多端协作平台

桌面 + 移动端统一的多 Agent 协作平台，支持局域网直连和跨网络云端中继。

## 📁 项目结构

```
.
├── desktop/          # 电脑端（Electron + React）
├── mobile/           # 手机端（Expo + React Native）
├── shared/           # 共享类型 & 通信协议
└── relay-server/     # 云端中继服务器
```

## 🚀 快速开始

### 电脑端
```bash
cd desktop
pnpm install
pnpm --filter @ensemble/shared build
pnpm --filter @ensemble/server build
pnpm --filter @ensemble/web build
pnpm --filter @ensemble/desktop start
```

### 手机端
```bash
cd mobile
npm install
npx expo start
```

### 中继服务器（可选）
```bash
cd relay-server
npm install
npm run dev
```

## 📱 手机电脑联动

支持两种连接模式：

### 📡 局域网直连
- 同一 WiFi 下自动发现（mDNS/Bonjour）
- WebSocket 直接通信，延迟最低
- 适合办公室、家庭等固定场景

### ☁️ 云端中继
- 通过阿里云服务器中继，支持跨网络连接
- 离线消息暂存，上线自动推送
- 适合出差、远程办公等移动场景

## 📚 文档

- [电脑端文档](desktop/README.md)
- [手机端文档](mobile/README.md)
- [通信协议](shared/PROTOCOL.md)
- [中继服务器文档](relay-server/README.md)
