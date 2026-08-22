@echo off
chcp 65001 >nul 2>&1
:menu
cls
echo.
echo  ╔══════════════════════════════════════════════════════════════╗
echo  ║                    合鸣 · 版本选择                          ║
echo  ╚══════════════════════════════════════════════════════════════╝
echo.
echo  [1] 本地版 - 完全离线运行
echo      ● 数据存储在本机
echo      ● 无需登录，直接进入
echo      ● 支持本地 Agent
echo.
echo  [2] 云端版 - 连接云端服务器
echo      ● 数据存储在云端，多端同步
echo      ● 直接进入登录页面
echo      ● 手机可远程控制电脑
echo.
echo  [3] 退出
echo.
echo  ─────────────────────────────────────────────────────────────
echo.
set /p choice=请选择版本 (1/2/3): 

if "%choice%"=="1" (
    cd /d "%~dp0ensemble-local"
    start.bat
)
if "%choice%"=="2" (
    cd /d "%~dp0ensemble-cloud"
    start.bat
)
if "%choice%"=="3" exit
goto menu
