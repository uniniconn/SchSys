@echo off
rem ============================================================================
rem  Scheduling System - stop the service started by the launcher
rem ============================================================================
chcp 65001 >nul
setlocal
set "PROJECT_DIR=%~dp0"
title Scheduling System - Stop

node "%PROJECT_DIR%scripts\launcher.mjs" stop
echo.
pause
endlocal
