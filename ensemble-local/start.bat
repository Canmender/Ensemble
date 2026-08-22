@echo off
chcp 65001 >nul 2>&1
echo.
echo  ╔══════════════════════════════════════╗
echo  ║     合鸣 · 本地版 v0.8.0            ║
echo  ║     完全离线，数据存储在本机         ║
echo  ╚══════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: 检查是否已安装依赖
if not exist "node_modules" (
    echo [!] 首次运行，正在安装依赖...
    call pnpm install
    echo.
)

:: 设置本地环境变量
set ENSEMBLE_MODE=local
set CLOUD_HOST=
set RELAY_URL=
set RELAY_AUTH_KEY=

:: 启动后端
echo [1/2] 启动后端服务...
start "合鸣后端-本地" cmd /c "cd packages\server && set PORT=8787 && set ENSEMBLE_MODE=local && npx tsx watch src/index.ts"
timeout /t 4 /nobreak >nul

:: 启动前端（强制本地模式，跳过登录）
echo [2/2] 启动前端...
echo.
echo  ✅ 访问地址: http://localhost:5173
echo  📁 数据目录: data
echo  🔒 模式: 本地（无需登录，直接进入）
echo.
echo  按 Ctrl+C 停止所有服务
echo.

cd packages\web && set VITE_FORCE_MODE=local && npx vite
