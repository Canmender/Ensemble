# 🌴 合鸣（Ensemble）— 多端协作平台

桌面 + 移动端统一的多 Agent 协作平台。

## 📁 项目结构

```
.
├── desktop/          # 电脑端（Electron + React）
├── mobile/           # 手机端（Expo + React Native）
└── shared/           # 共享类型 & 通信协议
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

## 📱 手机电脑联动

**无需云服务器**，同一 WiFi 下自动发现并通信：
- mDNS/Bonjour 自动发现设备
- WebSocket 实时双向通信
- REST API 调用

## 📚 文档

- [电脑端文档](desktop/README.md)
- [手机端文档](mobile/README.md)
- [通信协议](shared/PROTOCOL.md)
