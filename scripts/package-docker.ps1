# =============================================================================
#  Build and export the scheduling-system Docker image (Windows / PowerShell)
#
#  Usage:
#    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\package-docker.ps1
#    powershell ... -File scripts\package-docker.ps1 -Pg            # PostgreSQL variant
#    powershell ... -File scripts\package-docker.ps1 -ContextOnly   # only the build context
#
#  Output (dist/):
#    scheduling-system-<version>-<provider>.tar          docker save archive
#    scheduling-system-<version>-<provider>.tar.sha256   checksum
#    scheduling-system-docker-context-<version>.tar.gz   ready-to-build context
#
#  Requirements: Docker CLI + a RUNNING Docker engine (Docker Desktop / remote).
# =============================================================================
[CmdletBinding()]
param(
  [switch]$Pg,
  [switch]$ContextOnly,
  [string]$Tag,
  [switch]$Latest
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$pkg = Get-Content (Join-Path $ProjectRoot 'package.json') -Raw | ConvertFrom-Json
$version = $pkg.version
$provider = if ($Pg) { 'postgresql' } else { 'sqlite' }
if (-not $Tag) { $Tag = "scheduling-system:$version" }
$dist = Join-Path $ProjectRoot 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null

Write-Host "[1/4] Build context ($provider)" -ForegroundColor Cyan
& node (Join-Path $ProjectRoot 'scripts\package-docker-context.mjs')
if ($LASTEXITCODE -ne 0) { throw 'failed to create build context' }

if ($ContextOnly) {
  Write-Host '[2/4] -ContextOnly specified: skipping image build' -ForegroundColor Yellow
  exit 0
}

Write-Host '[2/4] Checking Docker engine' -ForegroundColor Cyan
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
  Write-Host '  [!] docker CLI not found. Install Docker Desktop, or build the context archive on another machine.' -ForegroundColor Red
  exit 2
}

$serverVersion = $null
try { $serverVersion = (& docker version --format '{{.Server.Version}}' 2>$null | Select-Object -First 1) } catch { $serverVersion = $null }
if (-not $serverVersion) {
  Write-Host '  [!] Docker engine is NOT running (cannot connect to the daemon).' -ForegroundColor Red
  Write-Host '      - Start Docker Desktop and wait until it reports "Engine running", then retry.' -ForegroundColor Yellow
  Write-Host '      - If Docker Desktop cannot start, check that virtualization is enabled' -ForegroundColor Yellow
  Write-Host '        (WSL2: `wsl --status`; Hyper-V: `systeminfo`).' -ForegroundColor Yellow
  Write-Host "      - The build context was still produced: $dist\scheduling-system-docker-context-$version.tar.gz" -ForegroundColor Yellow
  exit 2
}
Write-Host "  engine $serverVersion" -ForegroundColor Green

Write-Host "[3/4] Building image $Tag (DATABASE_PROVIDER=$provider)" -ForegroundColor Cyan
& docker build --build-arg "DATABASE_PROVIDER=$provider" -t $Tag .
if ($LASTEXITCODE -ne 0) { throw 'docker build failed' }
if (-not $Latest) {
  & docker tag $Tag scheduling-system:latest
}

$tarPath = Join-Path $dist "scheduling-system-$version-$provider.tar"
Write-Host "[4/4] Exporting image -> $tarPath" -ForegroundColor Cyan
& docker save -o $tarPath $Tag
if ($LASTEXITCODE -ne 0) { throw 'docker save failed' }

$hash = (Get-FileHash $tarPath -Algorithm SHA256).Hash.ToLower()
$sizeMb = [math]::Round((Get-Item $tarPath).Length / 1MB, 2)
Set-Content -Path "$tarPath.sha256" -Value "$hash  scheduling-system-$version-$provider.tar" -Encoding ASCII

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green
Write-Host "  image tag : $Tag (also scheduling-system:latest)"
Write-Host "  image tar : $tarPath ($sizeMb MB)"
Write-Host "  sha256    : $hash"
Write-Host ''
Write-Host 'On the target server:'
Write-Host "  docker load -i scheduling-system-$version-$provider.tar"
Write-Host '  docker run -d --name scheduling -p 3000:3000 \'
Write-Host '    -e SESSION_SECRET="<random>" \'
Write-Host '    -e INITIAL_ADMIN_USERNAME=admin \'
Write-Host '    -e INITIAL_ADMIN_PASSWORD="<password>" \'
Write-Host '    -e BASE_URL="https://your-domain.com" \'
Write-Host '    -v scheduling-data:/app/prisma/data \'
Write-Host "    $Tag"
