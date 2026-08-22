@echo off
chcp 65001 >nul 2>&1
echo.
echo  ╔══════════════════════════════════════╗
echo  ║     合鸣 · 云端版 v0.8.0            ║
echo  ║     连接云端，支持多端协作           ║
echo  ╚══════════════════════════════════════╝
echo.
echo  🌐 云端服务器: 47.92.39.184:8787
echo  📡 中继服务器: 47.92.39.184:8888
echo.

cd /d "%~dp0"

:: 检查是否已安装依赖
if not exist "node_modules" (
    echo [!] 首次运行，正在安装依赖...
    call pnpm install
    echo.
)

:: 设置云端环境变量
set ENSEMBLE_MODE=multi
set CLOUD_HOST=47.92.39.184:8787
set RELAY_URL=http://47.92.39.184:8888
set RELAY_AUTH_KEY=6d77fe6b2c7f7a4fa19118e2bb2433be0f7cb62156b1ed5e
set ENSEMBLE_API_KEY=d6530c2743ed895ffd19f4f5285766a681eed9f55b824193

:: 启动后端
echo [1/2] 启动后端服务（连接云端）...
start "合鸣后端-云端" cmd /c "cd packages\server && set PORT=8787 && set ENSEMBLE_MODE=multi && set CLOUD_HOST=47.92.39.184:8787 && npx tsx watch src/index.ts"
timeout /t 4 /nobreak >nul

:: 启动前端（强制云端模式，直接显示登录页）
echo [2/2] 启动前端...
echo.
echo  ✅ 访问地址: http://localhost:5173
echo  🔑 直接进入登录页面
echo.
echo  按 Ctrl+C 停止所有服务
echo.

cd packages\web && set VITE_FORCE_MODE=multi && npx vite
