# 合鸣中继服务器部署指南

## 服务器信息

- **公网 IP**: `<YOUR_SERVER_IP>`
- **私有 IP**: `<YOUR_PRIVATE_IP>`
- **系统**: Ubuntu
- **端口**: 8888

## 快速部署（手动）

### 1. 本地构建

```bash
cd relay-server
npm install
npm run build
```

### 2. 上传文件到服务器

```bash
# 使用 scp 上传
scp -r dist/ package.json package-lock.json root@<YOUR_SERVER_IP>:/opt/ensemble/relay-server/

# 或者使用 sftp
sftp root@<YOUR_SERVER_IP>
mkdir -p /opt/ensemble/relay-server
put -r dist/
put package.json
put package-lock.json
exit
```

### 3. SSH 连接服务器

```bash
ssh root@<YOUR_SERVER_IP>
```

### 4. 在服务器上安装和启动

```bash
# 进入部署目录
cd /opt/ensemble/relay-server

# 安装生产依赖
npm install --production

# 安装 PM2（如果没有）
npm install -g pm2

# 启动服务
PORT=8888 pm2 start dist/index.js --name ensemble-relay

# 保存 PM2 配置
pm2 save

# 设置开机自启
pm2 startup
```

### 5. 验证部署

```bash
# 检查服务状态
pm2 status

# 查看日志
pm2 logs ensemble-relay

# 测试健康检查
curl http://localhost:8888/health

# 从外部测试
curl http://<YOUR_SERVER_IP>:8888/health
```

## 防火墙配置

如果端口未开放，需要配置防火墙：

```bash
# 使用 ufw
sudo ufw allow 8888/tcp
sudo ufw reload

# 或使用 iptables
sudo iptables -A INPUT -p tcp --dport 8888 -j ACCEPT
sudo netfilter-persistent save
```

## 常用命令

```bash
# 查看服务状态
pm2 status

# 查看日志
pm2 logs ensemble-relay

# 重启服务
pm2 restart ensemble-relay

# 停止服务
pm2 stop ensemble-relay

# 查看监控
pm2 monit
```

## 配置环境变量

创建 `.env` 文件：

```bash
cat > /opt/ensemble/relay-server/.env << EOF
PORT=8888
CORS_ORIGINS=*
OFFLINE_MESSAGE_EXPIRY=86400000
LOG_LEVEL=info
EOF
```

然后重启服务：

```bash
pm2 restart ensemble-relay
```

## 故障排除

### 端口被占用

```bash
# 查看端口占用
lsof -i :8888

# 杀掉占用进程
kill -9 <PID>
```

### 服务无法启动

```bash
# 查看详细日志
pm2 logs ensemble-relay --lines 100

# 检查 Node.js 版本
node --version  # 需要 >= 18
```

### 无法从外部访问

1. 检查防火墙是否开放端口
2. 检查阿里云安全组是否允许 8888 端口
3. 检查服务是否监听 0.0.0.0
