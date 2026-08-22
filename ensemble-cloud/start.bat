@echo off
chcp 65001 >nul 2>&1
echo.
echo  ╔══════════════════════════════════════╗
echo  ║     合鸣 · 云端版 v0.8.0            ║
echo  ║     连接云端，支持多端协作           ║
echo  ╚══════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: 从本地 .env（gitignore，不入仓库）读取真实云端配置：
:: 优先本目录 .env，其次仓库根 .env。需要的变量：
::   CLOUD_HOST / RELAY_URL / RELAY_AUTH_KEY / ENSEMBLE_API_KEY
set "ENV_FILE=%~dp0.env"
if not exist "%ENV_FILE%" set "ENV_FILE=%~dp0..\.env"
if exist "%ENV_FILE%" (
    for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%ENV_FILE%") do set "%%a=%%b"
) else (
    echo [!] 未找到 .env，请参照 VERSION-MANAGEMENT.md 配置后重试
)

:: 缺省回退：本地开发默认值
if "%CLOUD_HOST%"=="" set "CLOUD_HOST=localhost:8787"
if "%RELAY_URL%"=="" set "RELAY_URL=http://localhost:8888"

echo  🌐 云端服务器: %CLOUD_HOST%
echo  📡 中继服务器: %RELAY_URL%
echo.

:: 检查是否已安装依赖
if not exist "node_modules" (
    echo [!] 首次运行，正在安装依赖...
    call pnpm install
    echo.
)

:: 云端模式
set ENSEMBLE_MODE=multi

:: 启动后端（连接云端）
echo [1/2] 启动后端服务（连接云端）...
start "合鸣后端-云端" cmd /c "cd packages\server && set PORT=8787 && set ENSEMBLE_MODE=multi && set CLOUD_HOST=%CLOUD_HOST% && npx tsx watch src/index.ts"
timeout /t 4 /nobreak >nul

:: 启动前端（强制云端模式，直接显示登录页；代理目标跟随 CLOUD_HOST）
echo [2/2] 启动前端...
echo.
echo  ✅ 访问地址: http://localhost:5173
echo  🔑 直接进入登录页面
echo.
echo  按 Ctrl+C 停止所有服务
echo.

cd packages\web && set VITE_FORCE_MODE=multi && set "CLOUD_API_ORIGIN=http://%CLOUD_HOST%" && npx vite
