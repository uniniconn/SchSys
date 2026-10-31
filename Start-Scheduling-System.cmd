@echo off
rem ============================================================================
rem  Scheduling System - one click start (production mode)
rem  1. prepare env / install deps (first run)
rem  2. prisma generate + migrate deploy
rem  3. build only when sources changed
rem  4. start server (next start) and open the web UI in your browser
rem  Stop: close this window or press Ctrl+C
rem  Options:  --port 3100   --no-browser   --force-build
rem ============================================================================
chcp 65001 >nul
setlocal
set "PROJECT_DIR=%~dp0"
title Scheduling System - Start

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js not found. Please install Node.js 20.11+ from https://nodejs.org
  echo.
  pause
  exit /b 1
)

node "%PROJECT_DIR%scripts\launcher.mjs" start %*
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" (
  echo.
  echo Launcher exited with code %EXITCODE%
  pause
)
endlocal
