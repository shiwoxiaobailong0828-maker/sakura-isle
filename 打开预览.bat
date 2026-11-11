@echo off
chcp 65001 >nul
title 樱花岛 · 本地预览
cd /d "%~dp0"

echo ========================================
echo   樱花岛 本地预览
echo ========================================
echo.

rem 1) 如果 8770 端口没在监听，就启动本地服务
netstat -ano | findstr ":8770" | findstr "LISTENING" >nul
if errorlevel 1 (
  echo [1/2] 正在启动本地服务 8770 ...
  start "" /min "C:\Users\bailong\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" "%~dp0tools\serve.py" 8770
  timeout /t 2 >nul
) else (
  echo [1/2] 本地服务已在运行
)

echo [2/2] 正在打开浏览器 ...
start "" "http://127.0.0.1:8770/"

echo.
echo 已打开：http://127.0.0.1:8770/
echo 这个窗口可以关掉了（服务在后台继续跑）。
echo.
timeout /t 3 >nul
