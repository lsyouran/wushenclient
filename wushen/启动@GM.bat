@echo off
chcp 65001 >nul
title WuShenMud2 GM版

echo ========================================
echo   WuShenMud2 游戏服务器 + GM后台
echo ========================================
echo.

:: 检查并杀掉占用端口的进程
echo [1/3] 检查端口占用...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8088') do (
    echo 结束进程 %%a
    taskkill /PID %%a /F 2>nul
)
timeout /t 1 /nobreak >nul

echo [2/3] 启动游戏服务器...
start "游戏服务器" cmd /c "node main.js"

timeout /t 3 /nobreak >nul

echo [3/3] 启动Web服务器...
start "Web服务器" cmd /c "node web.js"

echo.
echo ========================================
echo ✅ 启动完成！
echo 📍 GM后台: http://localhost:8088/gm
echo 📡 游戏: ws://127.0.0.1:31300
echo ========================================
echo.
pause