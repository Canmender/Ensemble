# 合鸣 · 本地版

完全离线运行的多 Agent 协作平台。

## 快速开始

1. 运行 `start.bat`
2. 打开浏览器访问 http://localhost:5173
3. 无需登录，直接使用

## 功能特性

- ✅ 完全离线运行，无需网络
- ✅ 数据存储在本机（SQLite）
- ✅ 无需登录，开箱即用
- ✅ 支持本地 Agent（Claude Code / Hermes / OpenCode 等）
- ✅ 内置 LLM 本地推理（llama.cpp）

## 目录结构

```
ensemble-local/
├── .env              # 环境配置
├── start.bat         # 启动脚本
├── README.md         # 本文件
├── packages/         # 源代码（软链接到主仓库）
├── config/           # 配置文件
└── data/             # 数据库文件
```

## 数据位置

- 数据库: `data/ensemble.db`
- 配置: `config/`
- 技能: `data/skills/`

## 注意事项

- 数据仅存储在本机，不会同步到云端
- 手机端可通过局域网直连
- 所有配置独立于云端版
