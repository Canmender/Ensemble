# 合鸣版本管理

## 概述

合鸣项目分为两个独立版本，共享同一套源代码，但配置和数据完全隔离。

## 目录结构

```
D:\MultiAgent/
├── 合鸣.bat                    # 主启动器（选择版本）
├── ensemble-local/             # 本地版
│   ├── .env                    # 本地配置
│   ├── start.bat               # 启动脚本
│   ├── README.md               # 说明文档
│   ├── packages/ → desktop/    # 源代码（软链接）
│   ├── config/                 # 独立配置目录
│   └── data/                   # 独立数据目录
├── ensemble-cloud/             # 云端版
│   ├── .env                    # 云端配置
│   ├── start.bat               # 启动脚本
│   ├── README.md               # 说明文档
│   ├── packages/ → desktop/    # 源代码（软链接）
│   ├── config/                 # 独立配置目录
│   └── data/                   # 独立数据目录
└── desktop/                    # 主开发目录
    └── packages/               # 源代码
```

## 版本区别

| 特性 | 本地版 | 云端版 |
|------|--------|--------|
| **数据位置** | 本机 SQLite | 云端服务器 |
| **登录** | 无需登录 | 需要云端账号 |
| **网络** | 完全离线 | 需要网络 |
| **手机直连** | 局域网可选 | 直连云端 |
| **数据同步** | 无 | 多端同步 |
| **Agent** | 本地 CLI | 云端配置 |
| **启动命令** | `start-local.bat` | `start-cloud.bat` |

## 使用方式

### 方式一：使用启动器

1. 双击 `合鸣.bat`
2. 选择「本地版」或「云端版」
3. 自动启动对应版本

### 方式二：直接启动

**本地版:**
```bash
cd ensemble-local
start.bat
```

**云端版:**
```bash
cd ensemble-cloud
start.bat
```

## 配置说明

### 本地版配置 (.env)

```env
PORT=8787
ENSEMBLE_MODE=local
CLOUD_HOST=
RELAY_URL=
RELAY_AUTH_KEY=
DB_PATH=data/ensemble.db
CONFIG_DIR=config
```

### 云端版配置 (.env)

```env
PORT=8787
ENSEMBLE_MODE=multi
CLOUD_HOST=47.92.39.184:8787
RELAY_URL=http://47.92.39.184:8888
RELAY_AUTH_KEY=xxx
DB_PATH=data/ensemble.db
CONFIG_DIR=config
ENSEMBLE_API_KEY=xxx
ENSEMBLE_LAN_HOST=0.0.0.0
```

## 开发说明

- 两个版本共享同一套源代码（通过软链接）
- 修改源代码后两个版本都会更新
- 配置和数据完全隔离，互不影响
- 每个版本有独立的 .env 配置

## 注意事项

1. **软链接**: `packages/` 目录是软链接，指向 `desktop/packages/`
2. **数据隔离**: 每个版本的 `data/` 和 `config/` 目录是独立的
3. **端口冲突**: 两个版本不能同时运行（都使用 8787 端口）
4. **依赖安装**: 首次运行需要在对应目录执行 `pnpm install`
