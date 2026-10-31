<#
================================================================================
 排班系统 · 后台启动（PowerShell 包装；核心逻辑在 scripts\launcher.mjs）
================================================================================
 服务在后台常驻，日志：.run\logs\server.out.log
 停止：scripts\stop-scheduling.ps1 或项目根目录的 停止排班系统.cmd
================================================================================
#>
[CmdletBinding()]
param(
  [int]$Port = 3000,
  [string]$BindHost = '127.0.0.1',
  [switch]$NoBrowser,
  [switch]$ForceBuild,
  [string]$OpenPath = '/admin/login'
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $ProjectRoot 'scripts\launcher.mjs'

$arguments = @($launcher, 'start', '--background', '--port', "$Port", '--host', $BindHost, '--open', $OpenPath)
if ($NoBrowser) { $arguments += '--no-browser' }
if ($ForceBuild) { $arguments += '--force-build' }

& node @arguments
exit $LASTEXITCODE
