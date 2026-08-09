@echo off
REM 合鸣中继服务器部署脚本 (Windows)
REM 用法: deploy.bat

set SERVER_IP=47.92.39.184
set SERVER_USER=root
set DEPLOY_DIR=/opt/ensemble/relay-server

echo 🚀 开始部署合鸣中继服务器到 %SERVER_IP%

REM 1. 构建本地代码
echo 📦 构建本地代码...
call npm run build

echo.
echo 请手动执行以下步骤完成部署：
echo.
echo 1. 上传文件到服务器：
echo    scp -r dist/ package.json package-lock.json root@%SERVER_IP%:%DEPLOY_DIR%/
echo.
echo 2. SSH 连接服务器：
echo    ssh root@%SERVER_IP%
echo.
echo 3. 在服务器上执行：
echo    cd %DEPLOY_DIR%
echo    npm install --production
echo    npm install -g pm2
echo    PORT=8888 pm2 start dist/index.js --name ensemble-relay
echo    pm2 save
echo    pm2 startup
echo.
echo 4. 验证部署：
echo    curl http://%SERVER_IP%:8888/health
echo.
pause
