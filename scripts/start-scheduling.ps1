<#
================================================================================
 排班系统 · 一键启动（PowerShell 包装；核心逻辑在 scripts\launcher.mjs）
================================================================================
 说明：若本机 PowerShell 执行策略限制 .ps1，请直接使用项目根目录的
       启动排班系统.cmd（它通过 Node 启动器运行，不受执行策略影响）。
 用法：
   powershell -ExecutionPolicy Bypass -File scripts\start-scheduling.ps1
   powershell -ExecutionPolicy Bypass -File scripts\start-scheduling.ps1 -Port 3100 -NoBrowser
   powershell -ExecutionPolicy Bypass -File scripts\start-scheduling.ps1 -Background
================================================================================
#>
[CmdletBinding()]
param(
  [int]$Port = 3000,
  [string]$BindHost = '127.0.0.1',
  [switch]$NoBrowser,
  [switch]$ForceBuild,
  [switch]$SkipInstall,
  [switch]$Background,
  [string]$OpenPath = '/admin/login'
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $ProjectRoot 'scripts\launcher.mjs'

$arguments = @($launcher, 'start', '--port', "$Port", '--host', $BindHost, '--open', $OpenPath)
if ($NoBrowser) { $arguments += '--no-browser' }
if ($ForceBuild) { $arguments += '--force-build' }
if ($SkipInstall) { $arguments += '--skip-install' }
if ($Background) { $arguments += '--background' }

& node @arguments
exit $LASTEXITCODE
