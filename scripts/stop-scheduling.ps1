<#
================================================================================
 排班系统 · 停止服务（PowerShell 包装）
================================================================================
 只会停止由启动器拉起的服务（依据 .run\server.pid），不会误杀其他 node 进程。
================================================================================
#>
[CmdletBinding()]
param([int]$Port = 3000, [string]$BindHost = '127.0.0.1')

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$ProjectRoot = Split-Path -Parent $PSScriptRoot
& node (Join-Path $ProjectRoot 'scripts\launcher.mjs') stop
exit $LASTEXITCODE
