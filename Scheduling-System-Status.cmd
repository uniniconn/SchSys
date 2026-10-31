@echo off
rem ============================================================================
rem  Scheduling System - service status
rem ============================================================================
chcp 65001 >nul
setlocal
set "PROJECT_DIR=%~dp0"
title Scheduling System - Status

node "%PROJECT_DIR%scripts\launcher.mjs" status
echo.
pause
endlocal
