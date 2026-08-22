@echo off
chcp 65001 >nul 2>&1
:: 用法: launch-desktop.bat [local^|cloud]
:: 构建并启动「原生桌面版」（Electron），本地版/云端版工作区完全隔离：
::   数据库/配置/密钥/登录态 各自独立（userData 按 editions/<版本> 分区），
::   两个版本可同时运行，互不污染。本目录即主开发目录 desktop/。

set "EDITION=%~1"
if not "%EDITION%"=="local" if not "%EDITION%"=="cloud" set "EDITION=local"

set "DESKTOP_DIR=%~dp0"
cd /d "%DESKTOP_DIR%"

echo.
echo  ╔══════════════════════════════════════╗
if "%EDITION%"=="local" (
    echo  ║      合鸣 · 本地版（原生桌面）       ║
    echo  ║      完全离线 · 数据存储在本机       ║
) else (
    echo  ║      合鸣 · 云端版（原生桌面）       ║
    echo  ║      连接云端 · 多端协作             ║
)
echo  ╚══════════════════════════════════════╝
echo.

:: 定位 electron.exe（pnpm 提升位置优先，其次包内）
set "ELECTRON_EXE=%DESKTOP_DIR%node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON_EXE%" set "ELECTRON_EXE=%DESKTOP_DIR%packages\desktop\node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON_EXE%" (
    echo [!] 未找到 electron.exe，请先在 desktop 目录执行: pnpm install
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [1/3] 首次运行，安装依赖...
    call pnpm install
    if errorlevel 1 (echo 依赖安装失败 & pause & exit /b 1)
)

if not exist "packages\web\dist\index.html" (
    echo [2/3] 构建前端与后端（首次约需几分钟）...
    call pnpm --filter @ensemble/shared build
    call pnpm --filter @ensemble/server build
    call pnpm --filter @ensemble/web build
    if errorlevel 1 (echo 构建失败 & pause & exit /b 1)
)

echo [3/3] 启动合鸣（%EDITION%）...
call pnpm --filter @ensemble/desktop build
start "合鸣" "%ELECTRON_EXE%" "%DESKTOP_DIR%packages\desktop" --ensemble-edition=%EDITION%
exit /b 0
