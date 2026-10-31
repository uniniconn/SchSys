# =============================================================================
#  Install desktop shortcuts for the Scheduling System (ASCII-only script body;
#  Chinese shortcut names are built from Unicode code points so the script works
#  regardless of the console code page).
#
#  Usage:
#    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-desktop-shortcuts.ps1
#    powershell ... -File scripts\install-desktop-shortcuts.ps1 -NoDesktopCopy
#    powershell ... -File scripts\install-desktop-shortcuts.ps1 -StartNow
# =============================================================================
[CmdletBinding()]
param(
  [switch]$NoDesktopCopy,
  [switch]$NoShortcuts,
  [switch]$StartNow
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Desktop = [Environment]::GetFolderPath('Desktop')
if ([string]::IsNullOrWhiteSpace($Desktop) -or -not (Test-Path $Desktop)) {
  $Desktop = Join-Path $env:USERPROFILE 'Desktop'
}
if (-not (Test-Path $Desktop)) { New-Item -ItemType Directory -Force -Path $Desktop | Out-Null }

# ---------------------------------------------------------------- source files
$startCmd  = Join-Path $ProjectRoot 'Start-Scheduling-System.cmd'
$deskCmd   = Join-Path $ProjectRoot 'scripts\desktop-launcher.cmd'
$stopCmd   = Join-Path $ProjectRoot 'Stop-Scheduling-System.cmd'
$statusCmd = Join-Path $ProjectRoot 'Scheduling-System-Status.cmd'
$startVbs  = Join-Path $ProjectRoot 'scripts\start-silent.vbs'
$stopVbs   = Join-Path $ProjectRoot 'scripts\stop-silent.vbs'
$launcher  = Join-Path $ProjectRoot 'scripts\launcher.mjs'

foreach ($required in @($startCmd, $deskCmd, $stopCmd, $startVbs, $stopVbs, $launcher)) {
  if (-not (Test-Path $required)) { throw "Missing required file: $required" }
}

# Chinese labels built from code points (no non-ASCII bytes in this script)
$nameStart      = [string]([char]0x542F + [char]0x52A8 + [char]0x6392 + [char]0x73ED + [char]0x7CFB + [char]0x7EDF)   # 启动排班系统
$nameStop       = [string]([char]0x505C + [char]0x6B62 + [char]0x6392 + [char]0x73ED + [char]0x7CFB + [char]0x7EDF)   # 停止排班系统
$nameStartSilent= [string]([char]0x542F + [char]0x52A8 + [char]0x6392 + [char]0x73ED + [char]0x7CFB + [char]0x7EDF + [char]0x0028 + [char]0x540E + [char]0x53F0 + [char]0x0029) # 启动排班系统(后台)
$descStart      = [string]([char]0x542F + [char]0x52A8 + [char]0x6392 + [char]0x73ED + [char]0x7CFB + [char]0x7EDF + [char]0xFF08 + [char]0x751F + [char]0x4EA7 + [char]0x6A21 + [char]0x5F0F + [char]0xFF0C + [char]0x81EA + [char]0x52A8 + [char]0x6253 + [char]0x5F00 + [char]0x6D4F + [char]0x89C8 + [char]0x5668 + [char]0xFF09)
$descStop       = [string]([char]0x505C + [char]0x6B62 + [char]0x6392 + [char]0x73ED + [char]0x7CFB + [char]0x7EDF + [char]0x670D + [char]0x52A1)

Write-Host "[1/3] Project: $ProjectRoot" -ForegroundColor Cyan
Write-Host "      Desktop: $Desktop" -ForegroundColor Cyan

# -------------------------------------------------- copy a launcher to Desktop
if (-not $NoDesktopCopy) {
  $target = Join-Path $Desktop ($nameStart + '.cmd')
  # 桌面版启动器自带 PROJECT_DIR，可在任意位置双击运行
  Copy-Item $deskCmd $target -Force
  Write-Host "[2/3] Copied launcher to desktop: $target" -ForegroundColor Green
} else {
  Write-Host "[2/3] Skipped copying launcher to desktop" -ForegroundColor Yellow
}

# ------------------------------------------------------------- create shortcuts
if (-not $NoShortcuts) {
  $shell = New-Object -ComObject WScript.Shell

  function New-Sc {
    param(
      [string]$LinkPath,
      [string]$TargetPath,
      [string]$Arguments,
      [string]$Description,
      [string]$WorkingDirectory,
      [string]$IconLocation
    )
    $sc = $shell.CreateShortcut($LinkPath)
    $sc.TargetPath = $TargetPath
    if ($Arguments) { $sc.Arguments = $Arguments }
    if ($Description) { $sc.Description = $Description }
    if ($WorkingDirectory) { $sc.WorkingDirectory = $WorkingDirectory }
    if ($IconLocation) { $sc.IconLocation = $IconLocation }
    $sc.WindowStyle = 1
    $sc.Save()
  }

  # start (silent, background service, opens the browser)
  New-Sc -LinkPath (Join-Path $Desktop ($nameStartSilent + '.lnk')) `
         -TargetPath 'wscript.exe' `
         -Arguments ('"' + $startVbs + '"') `
         -Description $descStart `
         -WorkingDirectory $ProjectRoot `
         -IconLocation "$env:SystemRoot\System32\shell32.dll,137"

  # stop
  New-Sc -LinkPath (Join-Path $Desktop ($nameStop + '.lnk')) `
         -TargetPath 'wscript.exe' `
         -Arguments ('"' + $stopVbs + '"') `
         -Description $descStop `
         -WorkingDirectory $ProjectRoot `
         -IconLocation "$env:SystemRoot\System32\shell32.dll,131"

  Write-Host "[3/3] Created shortcuts: $nameStartSilent.lnk / $nameStop.lnk" -ForegroundColor Green
} else {
  Write-Host "[3/3] Skipped shortcut creation" -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Desktop items:' -ForegroundColor Cyan
Get-ChildItem $Desktop -Force | Where-Object { $_.Name -like '*Scheduling*' -or $_.Name -like ($nameStart + '*') -or $_.Name -like ($nameStop + '*') } |
  ForEach-Object { Write-Host ('  - ' + $_.Name) -ForegroundColor Gray }

if ($StartNow) {
  Write-Host ''
  Write-Host 'Starting the service now...' -ForegroundColor Cyan
  & node $launcher start --background --no-browser
  Start-Process 'http://127.0.0.1:3000/admin/login' | Out-Null
  Write-Host 'Started. Browser opened at http://127.0.0.1:3000/admin/login' -ForegroundColor Green
}
