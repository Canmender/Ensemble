# 服务器部署指南

## 环境信息

| 项目 | 值 |
|---|---|
| 服务器 | SERVER_IP_REDACTED（阿里云） |
| 系统 | Docker Compose（server + relay） |
| 仓库 | `/opt/ensemble`（git，原地部署） |
| 端口 | 8787（server），8888（relay） |
| 数据目录 | `/data`（Docker volume `ensemble-data`：DB、附件、配置） |
| 配置文件 | `/opt/ensemble/.env`（未跟踪，含 `ENSEMBLE_API_KEY`、`ENSEMBLE_PORT`、`RELAY_AUTH_KEY`） |

---

## 部署流程

### 1. SSH 连接

```bash
ssh root@SERVER_IP_REDACTED
```

或通过 Python paramiko 非交互式连接（Claude Code 自动化用）。

### 2. 拉取最新代码

```bash
cd /opt/ensemble
git fetch origin main
git log origin/main -1 --oneline   # 确认拿到目标版本
git reset --hard origin/main       # .env 未跟踪，不会被覆盖
```

### 3. 重建并启动容器

```bash
docker compose up -d --build
```

- **server 镜像**：每次都会重建（`git reset` 改了源码，Dockerfile 层缓存失效，pnpm install + build web + tsc 重跑）
- **relay 镜像**：如果 relay-server 代码没改，会 CACHED（不会重建），这是正常的

### 4. 验证

```bash
# 容器状态
docker compose ps

# 健康检查
curl -s http://localhost:8787/api/health

# 关键端点（按版本）
curl -s -H "Authorization: Bearer <API_KEY>" http://localhost:8787/api/devices   # 多设备
curl -s -o /dev/null -w '%{http_code}' -X PATCH http://localhost:8787/api/auth/me  # 401 = 端点存在
```

---

## 踩过的坑

### 1. GitHub 间歇性不可达

服务器从阿里云访问 GitHub `https://github.com` 经常报：
- `fatal: unable to access '...': Empty reply from server`
- `fatal: unable to access '...': Failed to connect to github.com port 443: Connection timed out`

**解决方案**：写重试循环（3–6 次，每次间隔 5 秒），确认拿到目标版本号后再 reset。多次部署经验：一般第 2–3 次就能成功。

### 2. fetch 失败时 build 不会重建

如果 `git fetch` 失败，`reset --hard` 到的是旧 commit，`docker compose up -d --build` 因为代码没变（层缓存命中）不会重建 server 镜像。

**解决方案**：fetch 后检查 `git log origin/main -1 --oneline` 是否包含目标版本号，确认后再 reset + build。

### 3. .env 保留（未跟踪）

`/opt/ensemble/.env` 是 untracked 文件，`git reset --hard` 不会覆盖它。内容：
```
ENSEMBLE_API_KEY=API_KEY_REDACTED
ENSEMBLE_PORT=8787
RELAY_AUTH_KEY=RELAY_AUTH_KEY_REDACTED
```
- `ENSEMBLE_API_KEY`：机器级 API key（Bearer token 替代，WS / HTTP 统一）
- `RELAY_AUTH_KEY`：relay 连接鉴权

### 4. DB 迁移自动执行

新增数据库列（如 `attachment`、`deleted`、`reply_to`、`read_ts`、`devices` 表）的迁移在 server 启动时自动跑（`sqlite.ts` 的 `migrateUserColumns` 函数：`PRAGMA table_info` 检测 → `ALTER TABLE ADD COLUMN`）。**无需手动执行 SQL**。

旧库兼容设计：
- 无 `user_id` 列 → 重建 chat_messages 表（移除外键 + 加列）
- 无 `attachment` / `reply_to` / `deleted` / `read_ts` → `ALTER TABLE ADD COLUMN`

### 5. devices 端点对 API key 返回 401

`GET /api/devices` 需要**用户 token**（带 `user_id`）。`ENSEMBLE_API_KEY` 是系统级凭证（无用户归属），调 devices 返回 401 是**预期行为**。移动端 / 桌面端用登录用户的 token 正常工作。

### 6. relay 镜像保持旧版

relay-server 代码在 v0.7.3–v0.7.5 期间未改动，`docker compose up -d --build` 不会重建 relay。如果 relay 代码有改动，需要：
```bash
docker compose build relay --no-cache
docker compose up -d relay
```

### 7. compose version 警告

```
time="..." level=warning msg="/opt/ensemble/docker-compose.yml: `version` is obsolete"
```
这是 Docker Compose v2 的无害警告（`version: "3.8"` 字段过时）。可忽略，或删除 `docker-compose.yml` 里的 `version` 行消除。

### 8. 网络安全配置（移动端）

Android 9+ 默认禁止明文 HTTP。自用服务器用 `http://SERVER_IP_REDACTED:8787`，需要在移动端 APK 放行。

用 config plugin（`mobile/plugins/withNetworkSecurityConfig.js`）固化 `network_security_config.xml`，`expo prebuild` 时自动写入。放行清单：
- `SERVER_IP_REDACTED`
- `DOMAIN_REDACTED`
- `localhost`

**踩坑**：手动加到 `android/` 构建目录的 xml 会在 `expo prebuild --clean` 时被清掉。必须用 config plugin 固化。

### 9. Gradle daemon 文件锁（EBUSY）

`expo prebuild` 清理 android 目录时，如果 gradle daemon 还持有 build 产物（`classes3.dex`），会报 EBUSY。

**解决方案**：
```bash
# 先停 daemon
"<gradle-dist>/bin/gradle.bat" --stop
# 再删 android + prebuild
rm -rf android
npx expo prebuild --platform android
```

### 10. 阿里云备案与 HTTPS

- 域名 `DOMAIN_REDACTED` 的 80/443 端口被阿里云备案拦截
- nginx 证书已就绪，待备案合规后切换 `https://`
- 证书有效期至 **2026-08-15**，届时需续期

---

## 自动化部署（Claude Code）

部署可通过 `/deploy-server` 命令触发（`.claude/commands/deploy-server.md`），使用 paramiko SSH 自动完成：

1. commit 并 push 当前改动到 main
2. SSH 到服务器，fetch + 重试 + reset
3. `docker compose up -d --build`
4. 验证 health + 关键端点
5. 清理临时脚本

服务器密码从 `~/.claude` 记忆读取（或用户提供）。

---

## 数据与备份

| 数据 | 位置 | 备份策略 |
|---|---|---|
| SQLite DB | `/data/ensemble.db`（Docker volume） | 拷贝 db 文件 |
| 附件 | `/data/uploads/` | rsync |
| Agent/Workflow 配置 | `/data/config/` | git（可选） |
| .env | `/opt/ensemble/.env` | 手动备份 |

DB 备份：
```bash
docker cp ensemble-server:/data/ensemble.db ./ensemble-backup-$(date +%Y%m%d).db
```
