#!/bin/bash

# 合鸣中继服务器部署脚本
# 用法: ./deploy.sh <server-ip> <password>

set -e

SERVER_IP="${1:-SERVER_IP_REDACTED}"
SERVER_USER="root"
DEPLOY_DIR="/opt/ensemble/relay-server"

echo "🚀 开始部署合鸣中继服务器到 ${SERVER_IP}"

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

# 4. 安装依赖并启动
echo "🔧 安装依赖并启动..."
sshpass -p "${2}" ssh -o StrictHostKeyChecking=no ${SERVER_USER}@${SERVER_IP} << 'EOF'
cd /opt/ensemble/relay-server

# 安装依赖
npm install --production

# 检查 PM2 是否安装
if ! command -v pm2 &> /dev/null; then
  echo "安装 PM2..."
  npm install -g pm2
fi

# 停止旧进程
pm2 stop ensemble-relay 2>/dev/null || true
pm2 delete ensemble-relay 2>/dev/null || true

# 启动新进程
PORT=8888 pm2 start dist/index.js --name ensemble-relay

# 保存 PM2 配置
pm2 save

# 设置开机自启
pm2 startup

echo "✅ 部署完成"
EOF

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           部署完成！                                     ║"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║  服务器地址: http://${SERVER_IP}:8888                     ║"
echo "║  健康检查:   http://${SERVER_IP}:8888/health              ║"
echo "║  设备列表:   http://${SERVER_IP}:8888/devices             ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
