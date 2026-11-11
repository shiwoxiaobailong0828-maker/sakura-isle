@echo off
title Sakura Isle Preview
cd /d "%~dp0"
set "PY=C:\Users\bailong\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
netstat -ano | findstr ":8770" | findstr "LISTENING" >nul
if errorlevel 1 (
  if exist "%PY%" (
    start "" /min "%PY%" "%~dp0tools\serve.py" 8770
    ping 127.0.0.1 -n 2 >nul
  )
)
netstat -ano | findstr ":8770" | findstr "LISTENING" >nul
if errorlevel 1 (
  start "" "%~dp0dist\index.html"
) else (
  start "" "http://127.0.0.1:8770/"
)
