#!/bin/bash

# 合鸣中继服务器部署脚本
# 用法: ./deploy.sh <server-ip> <password> [relay-auth-key]
#   relay-auth-key 为 RELAY_AUTH_KEY（强烈建议生产环境设置，否则设备注册无鉴权）

set -e

SERVER_IP="${1:-YOUR_SERVER_IP}"
SERVER_USER="root"
DEPLOY_DIR="/opt/ensemble/relay-server"
RELAY_AUTH_KEY="${3:-}"

echo "🚀 开始部署合鸣中继服务器到 ${SERVER_IP}"
[ -z "$RELAY_AUTH_KEY" ] && echo "⚠️  未提供 RELAY_AUTH_KEY，设备注册与消息转发将无鉴权（不推荐用于生产）"

# 1. 构建本地代码
echo "📦 构建本地代码..."
npm run build

# 2. 创建远程目录
echo "📁 创建远程目录..."
sshpass -p "${2}" ssh -o StrictHostKeyChecking=no ${SERVER_USER}@${SERVER_IP} "mkdir -p ${DEPLOY_DIR}"

# 3. 上传文件
echo "📤 上传文件..."
sshpass -p "${2}" scp -o StrictHostKeyChecking=no -r \
  dist/ \
  package.json \
  package-lock.json \
  ${SERVER_USER}@${SERVER_IP}:${DEPLOY_DIR}/

# 4. 安装依赖并启动（RELAY_AUTH_KEY 作为环境变量传入远程）
echo "🔧 安装依赖并启动..."
sshpass -p "${2}" ssh -o StrictHostKeyChecking=no ${SERVER_USER}@${SERVER_IP} \
  "RELAY_AUTH_KEY='${RELAY_AUTH_KEY}' bash -s" << 'EOF'
cd /opt/ensemble/relay-server

# 安装生产依赖
npm install --production

# 检查 PM2 是否安装
if ! command -v pm2 &> /dev/null; then
  echo "安装 PM2..."
  npm install -g pm2
fi

# 写入 .env（含 RELAY_AUTH_KEY，供运行时读取）
cat > .env << INNER
PORT=8888
CORS_ORIGINS=*
RELAY_AUTH_KEY=${RELAY_AUTH_KEY}
OFFLINE_MESSAGE_EXPIRY=86400000
LOG_LEVEL=info
INNER

# 停止并删除旧进程
pm2 stop ensemble-relay 2>/dev/null || true
pm2 delete ensemble-relay 2>/dev/null || true

# 启动新进程
PORT=8888 RELAY_AUTH_KEY="$RELAY_AUTH_KEY" pm2 start dist/index.js --name ensemble-relay

# 保存 PM2 配置 + 设置开机自启
pm2 save
pm2 startup 2>/dev/null || true

echo "✅ 部署完成"
EOF

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           部署完成！                                     ║"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║  服务器地址: http://${SERVER_IP}:8888                     ║"
echo "║  健康检查:   http://${SERVER_IP}:8888/health              ║"
echo "║  鉴权:       $([ -n "$RELAY_AUTH_KEY" ] && echo "已启用 (RELAY_AUTH_KEY)" || echo "未启用")"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
