@echo off
chcp 65001 >nul 2>&1
:: 本地版入口 —— 已改为启动原生桌面版（Electron）。
:: 工作区按版本分区，与云端版完全隔离；本目录不再承载运行时数据。
call "%~dp0..\desktop\launch-desktop.bat" local
