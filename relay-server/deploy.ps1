# 合鸣中继服务器部署脚本 (PowerShell)
# 用法: .\deploy.ps1

$SERVER_IP = "YOUR_SERVER_IP"
$SERVER_USER = "root"
$DEPLOY_DIR = "/opt/ensemble/relay-server"

Write-Host "🚀 开始部署合鸣中继服务器到 $SERVER_IP" -ForegroundColor Cyan

# 1. 构建
Write-Host "📦 构建本地代码..." -ForegroundColor Yellow
npm run build

# 2. 上传文件
Write-Host "📤 上传文件到服务器..." -ForegroundColor Yellow
scp -r dist/ package.json package-lock.json "${SERVER_USER}@${SERVER_IP}:${DEPLOY_DIR}/"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 上传失败，请检查网络连接" -ForegroundColor Red
    exit 1
}

Write-Host "✅ 文件上传成功" -ForegroundColor Green

# 3. 执行远程命令
Write-Host "🔧 在服务器上安装依赖并启动..." -ForegroundColor Yellow

$remoteCommands = @"
cd /opt/ensemble/relay-server
npm install --production
npm install -g pm2
pm2 stop ensemble-relay 2>/dev/null || true
pm2 delete ensemble-relay 2>/dev/null || true
PORT=8888 pm2 start dist/index.js --name ensemble-relay
pm2 save
pm2 startup
echo 'DEPLOY_SUCCESS'
"@

ssh "${SERVER_USER}@${SERVER_IP}" $remoteCommands

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║           部署完成！                                     ║" -ForegroundColor Green
    Write-Host "╠═══════════════════════════════════════════════════════════╣" -ForegroundColor Green
    Write-Host "║  服务器地址: http://${SERVER_IP}:8888                     ║" -ForegroundColor Green
    Write-Host "║  健康检查:   http://${SERVER_IP}:8888/health              ║" -ForegroundColor Green
    Write-Host "║  设备列表:   http://${SERVER_IP}:8888/devices             ║" -ForegroundColor Green
    Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Green
} else {
    Write-Host "❌ 部署失败，请查看错误信息" -ForegroundColor Red
}
