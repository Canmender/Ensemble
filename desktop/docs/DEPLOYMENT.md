# 合鸣自用系统部署指南（轻量化）

部署一套自用实例到你的服务器，用于团队使用与测试。
基于：Node + SQLite（轻量，无外部数据库）+ 账号系统 + Docker Compose。

## 前置要求

- 一台云服务器（Ubuntu/Debian 推荐，2C2G 起步）
- Docker + Docker Compose
- 一个域名（可选，走 HTTPS 时用）

## 快速部署

### 1. 配置环境变量

在仓库根目录创建 `.env`：

```bash
# 公网部署必须设置：机器级 API key（同时禁用 /api/ws-token 防绕过）
ENSEMBLE_API_KEY=$(openssl rand -hex 32)

# 对外端口（默认 8787）
ENSEMBLE_PORT=8787

# 中继服务器（移动端跨网连接用，可选）
RELAY_AUTH_KEY=$(openssl rand -hex 32)
```

### 2. 构建并启动

```bash
docker compose up -d --build
```

启动后：
- Ensemble Server：`http://<服务器IP>:8787`
- Relay Server：`http://<服务器IP>:8888`

### 3. 初始化管理员账号

打开 Web UI，进入注册页创建第一个账号（即管理员）。

> 数据持久化在 Docker 卷 `ensemble-data`（SQLite + 配置 + agent 配置 + 记忆）。

## 移动端连接

- **局域网直连**：手机与服务器同网段时，移动端填 `http://<服务器IP>:8787`，API key 填 `ENSEMBLE_API_KEY`
- **中继**：移动端填 relay 地址 + `RELAY_AUTH_KEY`

## 生产加固（可选）

- **HTTPS**：用 `docker-compose.prod.yml`（内置 nginx + SSL 目录 `nginx/ssl`），或外部反代（Caddy/Nginx）
- **备份**：定期备份 Docker 卷 `ensemble-data`
- **防火墙**：只开放对外端口

## 架构

```
┌─────────────────────────────────────────────┐
│  nginx (可选，HTTPS)                          │
│    ├── / → ensemble-server:8787 (Web + API)  │
│    └── relay → relay-server:8888 (Socket.IO) │
├─────────────────────────────────────────────┤
│  ensemble-server  ── SQLite (ensemble-data)  │
│   账号系统 / Agent / 会话 / RAG / 工具         │
├─────────────────────────────────────────────┤
│  relay-server（移动端跨网中继）                │
└─────────────────────────────────────────────┘
```
