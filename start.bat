@echo off
title 需求单信息管理系统
color 0B
echo ============================================
echo   需求单信息管理系统 v1.4.0
echo   Requirement Order Manager
echo ============================================
echo.
echo 正在启动服务...

:: Get the directory of this batch file
set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"

:: Create data directory if not exists
if not exist "data" mkdir data

:: Check if node_modules exists
if not exist "node_modules" (
    echo [INFO] 正在安装依赖模块，请稍候...
    call npm install --production --no-audit --no-fund 2>&1
    if errorlevel 1 (
        echo [ERROR] 依赖安装失败！请确保已安装 Node.js。
        echo 下载地址: https://nodejs.org/
        echo.
        pause
        exit /b 1
    )
    echo [INFO] 依赖安装完成。
)

:: Start the server
echo.
echo [INFO] 服务启动中...
echo [INFO] 请浏览器访问: http://localhost:3000
echo [INFO] 按 Ctrl+C 停止服务
echo.
node server/index.js

pause