---
description: 部署合鸣服务器到云端（SERVER_IP_REDACTED）
---

部署合鸣（Ensemble）服务器到云端阿里云 SERVER_IP_REDACTED。

## 流程

### 1. 确认本地状态

检查当前是否有未 commit 的改动。如果在 worktree，先合并到 main 并 push：

```bash
cd D:/MultiAgent
git merge <worktree-branch> && git push origin main
```

记录本次要部署的版本号（git log -1 --oneline）。

### 2. SSH 到服务器（Python paramiko）

用非交互式 Python 脚本连接（Bash 工具不支持 SSH 密码输入）：

```python
import paramiko
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("SERVER_IP_REDACTED", username="root", password="<密码>")
```

密码从 `~/.claude/projects/D--MultiAgent/memory/` 里的记忆文件读取，或询问用户。

### 3. 拉取最新代码（含重试）

```bash
cd /opt/ensemble
git fetch origin main 2>&1
git log origin/main -1 --oneline   # 确认版本号
git reset --hard origin/main       # .env 未跟踪，不会丢
```

**关键**：`git fetch` 经常失败（GitHub 从阿里云间歇性不可达），需要重试 3–6 次，每次间隔 5 秒，确认拿到目标版本后再 reset。

失败信息：
- `fatal: Empty reply from server` — 重试
- `fatal: Connection timed out` — 重试

### 4. 重建并启动容器

```bash
docker compose up -d --build 2>&1 | tail -15
```

- server 镜像会重建（源码变了，层缓存失效）
- relay 镜像如果代码没变会 CACHED（正常，不需重建）

### 5. 验证

```bash
docker compose ps
curl -s http://localhost:8787/api/health | head -c 200
```

按版本需要验证关键端点（如新 API、DB 迁移）。

### 6. 清理

删除所有临时脚本（含服务器密码）：
```bash
rm -f /d/tmp/deploy_*.py
```

## 重要事项

- **`.env` 保留**：服务器 `/opt/ensemble/.env` 是 untracked，reset 不会覆盖（含 API key、端口、relay key）
- **DB 迁移自动**：新版本的 ALTER TABLE / CREATE TABLE 在 server 启动时自动跑
- **devices 端点 401 正常**：API key 是系统级（无 user），devices 需用户 token
- **relay 镜像缓存**：relay 代码没变时 docker 不会重建，这是对的
- **踩坑文档**：详见 `docs/DEPLOY.md`
