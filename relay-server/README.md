# 🌐 合鸣云端中继服务器

跨网络设备通信的中继服务器，支持手机端和电脑端在不同网络下实时同步。

## ✨ 功能特性

- **设备注册与发现** — 设备上线时自动注册，其他设备收到通知
- **实时消息转发** — Socket.IO 双向通信，毫秒级延迟
- **离线消息队列** — 设备离线时暂存消息，上线后自动推送并删除
- **心跳检测** — 自动检测设备在线状态
- **轻量级** — 云端只做传输媒介，不持久化业务数据

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18
- npm 或 yarn

### 安装

```bash
cd relay-server
npm install
```

### 配置

复制环境配置文件：

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置端口等参数。

### 运行

```bash
# 开发模式（热重载）
npm run dev

# 生产模式
npm run build
npm start
```

## 📦 部署到阿里云

### 1. 连接服务器

```bash
ssh root@your-server-ip
```

### 2. 安装 Node.js

```bash
# 使用 nvm 安装
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18
```

### 3. 上传代码

```bash
# 方法 1: git clone
git clone <your-repo-url>
cd ensemble/relay-server

# 方法 2: scp
scp -r ./relay-server root@your-server-ip:/opt/ensemble/
```

### 4. 安装依赖并启动

```bash
npm install
npm run build
npm start
```

### 5. 使用 PM2 守护进程（推荐）

```bash
npm install -g pm2
pm2 start dist/index.js --name ensemble-relay
pm2 save
pm2 startup
```

### 6. 配置 Nginx 反向代理（可选）

```nginx
server {
    listen 80;
    server_name relay.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 7. 配置防火墙

```bash
# 开放端口
sudo ufw allow 3001
# 或者使用 iptables
sudo iptables -A INPUT -p tcp --dport 3001 -j ACCEPT
```

## 🔌 API 接口

### HTTP 接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/devices` | GET | 获取在线设备列表 |

### WebSocket 事件

#### 客户端 → 服务器

| 事件 | 数据 | 说明 |
|------|------|------|
| `device:register` | `{ deviceId, deviceName, deviceType }` | 设备注册 |
| `message` | `{ to, type, payload }` | 发送消息 |
| `ping` | `{}` | 心跳 |

#### 服务器 → 客户端

| 事件 | 数据 | 说明 |
|------|------|------|
| `device:registered` | `{ success, deviceId, serverTime }` | 注册成功 |
| `device:list` | `{ devices: [] }` | 在线设备列表 |
| `device:online` | `{ id, name, type }` | 设备上线 |
| `device:offline` | `{ deviceId, name }` | 设备离线 |
| `message` | `{ id, from, to, type, payload, timestamp }` | 收到消息 |
| `message:queued` | `{ messageId, to, message }` | 消息已暂存 |
| `pong` | `{ serverTime }` | 心跳响应 |

## 📊 监控

### 健康检查

```bash
curl http://localhost:3001/health
```

响应：
```json
{
  "status": "ok",
  "devices": 2,
  "pendingMessages": 3,
  "uptime": 3600
}
```

### 查看日志

```bash
# PM2 日志
pm2 logs ensemble-relay

# 实时日志
pm2 logs ensemble-relay --lines 100
```

## 🔒 安全建议

1. **使用 HTTPS** — 配置 SSL 证书
2. **限制 CORS** — 只允许你的域名
3. **添加认证** — 实现 token 认证机制
4. **限制连接数** — 防止 DDoS 攻击
5. **定期更新** — 保持依赖最新

## 📝 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3001 | 服务器端口 |
| `CORS_ORIGINS` | * | 允许的源 |
| `OFFLINE_MESSAGE_EXPIRY` | 86400000 | 离线消息过期时间（ms） |
| `LOG_LEVEL` | info | 日志级别 |

## 🐛 故障排除

### 连接失败

1. 检查防火墙是否开放端口
2. 确认服务器 IP 地址正确
3. 检查网络连接

### 消息未送达

1. 确认目标设备已注册
2. 检查设备 ID 是否正确
3. 查看服务器日志

## 📄 许可证

MIT
