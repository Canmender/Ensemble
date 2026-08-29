# 合鸣自建推送方案 — ntfy + UnifiedPush

## 目标

实现"杀掉 App 也能收到消息通知"的推送能力，完全自建，不依赖 Google/华为/小米等厂商。

## 架构

```
合鸣主服务器                ntfy 推送服务器              用户手机
┌──────────┐   HTTP POST   ┌──────────┐   长连接    ┌──────────┐
│ 消息到达  │ ──────────>  │  ntfy    │ ─────────> │ ntfy App │
│ 查推送表  │              │ (Docker) │            │ 系统通知  │
│ 调ntfy API│              │          │            │          │
└──────────┘              └──────────┘            └──────────┘
```

## 需要的资源

### 推送服务器

| 项目 | 规格 |
|------|------|
| 配置 | 1 核 1G 内存 |
| 系统 | Ubuntu 22.04 / Debian 12 |
| 带宽 | 1Mbps 足够（推送消息 <1KB/条） |
| 费用 | ~30 元/月（阿里云轻量应用服务器） |
| 端口 | 80（HTTP）、443（HTTPS）、8080（WebSocket） |

### 域名（可选但推荐）

- 用于 HTTPS 加密通信
- 可用免费域名或已有域名的子域名

## 部署步骤

### 1. 购买服务器

在阿里云/腾讯云购买轻量应用服务器：
- 1 核 1G 内存
- Ubuntu 22.04
- 带宽 1Mbps
- 开放端口：80、443、8080

### 2. 安装 Docker

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker
```

### 3. 部署 ntfy

```bash
# 创建数据目录
mkdir -p /var/cache/ntfy

# 启动 ntfy
docker run -d \
  --name ntfy \
  --restart=always \
  -p 80:80 \
  -p 443:443 \
  -p 8080:8080 \
  -v /var/cache/ntfy:/var/cache/ntfy \
  -e NTFY_BASE_URL=https://<你的域名> \
  binwiederhier/ntfy \
  serve --cache-file /var/cache/ntfy/cache.db
```

### 4. 配置用户认证

```bash
# 创建管理员
docker exec -it ntfy ntfy user add --role=admin admin
# 创建推送用户
docker exec -it ntfy ntfy user add pushuser
# 授予推送权限
docker exec -it ntfy ntfy access '*' '*' pushuser rw
```

### 5. 配置合鸣服务器

在合鸣服务器的 `.env` 中添加：

```env
NTFY_SERVER=http://<NTFY服务器IP>:80
NTFY_TOKEN=<ntfy访问令牌>
```

### 6. 合鸣服务器端代码改动

#### 新增推送函数

文件：`desktop/packages/server/src/push/push.ts`

```typescript
export async function sendNtfyPush(topic: string, title: string, message: string) {
  const ntfyServer = process.env.NTFY_SERVER;
  const ntfyToken = process.env.NTFY_TOKEN;
  if (!ntfyServer || !ntfyToken) return;

  await fetch(`${ntfyServer}/${topic}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ntfyToken}`,
      "Title": title,
      "Tags": "ensemble",
      "Priority": "high",
    },
    body: message,
  });
}
```

#### 数据库改动

devices 表已有 `push_token` 列，改存 ntfy topic：

```sql
-- 新增 ntfy_topic 列（或复用 push_token 列）
ALTER TABLE devices ADD COLUMN ntfy_topic TEXT;
```

#### 推送触发逻辑

文件：`desktop/packages/server/src/api/ws/hub.ts`

在 `sendToUser` 中，WS 离线时调用 ntfy 推送：

```typescript
async sendToUser(userId: string, event: RunEvent) {
  const sockets = this.userSockets.get(userId);
  if (sockets && sockets.size > 0) {
    // 在线，通过 WS 推送
    for (const ws of sockets) ws.send(JSON.stringify(event));
  } else {
    // 离线，通过 ntfy 推送
    const devices = this.store?.listDevices(userId) ?? [];
    for (const device of devices) {
      if (device.ntfyTopic) {
        await sendNtfyPush(
          device.ntfyTopic,
          "合鸣",
          this.getPushPreview(event)
        );
      }
    }
  }
}
```

## 移动端改动

### 方案 A：让用户安装 ntfy App（最简单）

1. 用户从 Google Play / F-Droid 安装 ntfy App
2. 打开 ntfy App，点击 "Add Topic"
3. 输入合鸣服务器提供的 topic（如 `ensemble-user-12345`）
4. 完成

**优点：** 零开发量，用户装一次就行
**缺点：** 用户需要额外装 App

### 方案 B：内置 UnifiedPush 分发器（推荐）

在合鸣 App 中集成 UnifiedPush SDK，合鸣自己当推送接收器：

1. 集成 `unifiedpush-android-client` SDK
2. App 启动时注册 UnifiedPush
3. 收到推送后创建系统通知
4. 点击通知打开合鸣 App

**优点：** 用户无感知，不需要装额外 App
**缺点：** 开发量 ~1-2 周

### 方案 C：混合方案（推荐起步）

1. 先用方案 A（让用户装 ntfy App）快速验证
2. 验证通过后逐步迁移到方案 B（内置分发器）

## 安全设计

| 措施 | 说明 |
|------|------|
| Topic 随机化 | 每个用户生成 UUID 作为 topic，不可猜测 |
| Token 认证 | 发送端需要 Bearer token |
| HTTPS | 生产环境用 TLS 加密 |
| 消息不含正文 | 推送标题只显示"你有新消息"，不泄露内容 |
| Topic 绑定 | topic 与 userId 一对一绑定，不可跨用户 |

## 推送流程

```
1. 用户 A 发消息给用户 B
2. 合鸣服务器收到消息
3. 检查 B 是否在线（有 WebSocket 连接）
4. 如果在线 → WS 直接推送
5. 如果离线 → 查询 B 的 ntfy_topic
6. 调用 ntfy API：POST /{topic}
7. ntfy 服务器通过长连接推送到 B 的手机
8. ntfy App 接收 → 创建系统通知
9. B 点击通知 → 打开合鸣 App → 显示消息
```

## 成本估算

| 项目 | 费用 |
|------|------|
| 推送服务器 | ~30 元/月 |
| 域名 | ~10 元/年（可选） |
| 开发成本 | 服务器端 0.5 天 + 移动端 1-2 天 |
| 运维成本 | 几乎为零（Docker 自重启） |

## 对比其他方案

| 方案 | 需要厂商账号 | 国内可用 | 杀掉App能收 | 自建 | 费用 |
|------|------------|---------|------------|------|------|
| ntfy 自建 | ❌ | ✅ | ✅ | ✅ | 30元/月 |
| FCM | ✅ Google | ❌ | ✅ | ❌ | 免费 |
| 华为推送 | ✅ 华为 | ✅ | ✅ | ❌ | 免费 |
| 个推 | ✅ 个推 | ✅ | ✅ | ❌ | 按量付费 |
| WebSocket 保活 | ❌ | ✅ | ❌ | ✅ | 零 |

## 实施优先级

1. **Phase 1**：购买服务器 + 部署 ntfy（半天）
2. **Phase 2**：服务器端集成 ntfy 推送（0.5 天）
3. **Phase 3**：移动端注册 ntfy topic（0.5 天）
4. **Phase 4**：端到端测试（0.5 天）
5. **Phase 5**（可选）：内置 UnifiedPush 分发器（1-2 周）
