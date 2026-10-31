@echo off
rem ============================================================================
rem  Scheduling System - silent start (no console window)
rem  Service runs in background; log: .run\logs\server.out.log
rem ============================================================================
chcp 65001 >nul
setlocal
set "PROJECT_DIR=%~dp0"
wscript.exe "%PROJECT_DIR%scripts\start-silent.vbs"
endlocal
