@echo off
chcp 65001 >nul 2>&1
:: 云端版入口 —— 已改为启动原生桌面版（Electron）。
:: 云端地址/中继配置改在应用内「设置 → 运行模式」填写（存于云端版独立工作区）；
:: 工作区按版本分区，与本地版完全隔离；本目录不再承载运行时数据。
call "%~dp0..\desktop\launch-desktop.bat" cloud
