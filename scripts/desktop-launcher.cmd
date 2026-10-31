@echo off
rem ============================================================================
rem  Scheduling System - desktop launcher (double click to start)
rem
rem  This file is designed to sit on the Desktop. It calls the project's own
rem  one-click launcher, which will:
rem    - check Node.js / prepare .env / install deps (first run)
rem    - prisma generate + migrate deploy
rem    - build the production bundle only when sources changed
rem    - start the server and open the web UI in your browser
rem
rem  Stop: close the window or press Ctrl+C
rem ============================================================================
chcp 65001 >nul
setlocal
set "PROJECT_DIR=D:\School project"
set "LAUNCHER=%PROJECT_DIR%\scripts\launcher.mjs"
title Scheduling System - Start

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js not found. Please install Node.js 20.11+ from https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "%LAUNCHER%" (
  echo.
  echo [ERROR] Launcher not found:
  echo         %LAUNCHER%
  echo.
  echo If the project folder was moved, edit PROJECT_DIR at the top of this file.
  echo.
  pause
  exit /b 1
)

node "%LAUNCHER%" start %*
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" (
  echo.
  echo Launcher exited with code %EXITCODE%
  pause
)
endlocal
