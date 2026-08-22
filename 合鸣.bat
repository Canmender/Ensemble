@echo off
chcp 65001 >nul 2>&1
:menu
cls
echo.
echo  ╔══════════════════════════════════════════════════════════════╗
echo  ║              合鸣 · 版本选择（原生桌面版）                   ║
echo  ╚══════════════════════════════════════════════════════════════╝
echo.
echo  [1] 本地版 - 完全离线运行
echo      ● 数据存储在本机，独立工作区
echo      ● 无需登录，直接进入
echo      ● 支持本地 Agent
echo.
echo  [2] 云端版 - 连接云端服务器
echo      ● 数据存储在云端，多端同步
echo      ● 独立工作区，与本地版互不污染
echo      ● 直接进入登录页面，手机可远程控制电脑
echo      ● 两版可同时运行（各自独立窗口）
echo.
echo  [3] 退出
echo.
echo  ─────────────────────────────────────────────────────────────
echo.
set /p choice=请选择版本 (1/2/3):

if "%choice%"=="1" call "%~dp0desktop\launch-desktop.bat" local
if "%choice%"=="2" call "%~dp0desktop\launch-desktop.bat" cloud
if "%choice%"=="3" exit
goto menu
