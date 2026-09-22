<#
.SYNOPSIS
  Build this plugin and deploy it to a live Millennium install as a parallel
  "-dev" copy, then restart Steam.

.DESCRIPTION
  Deploys as "<name>-dev" so a released copy of the plugin stays installed and
  untouched. The released one is disabled and the dev one enabled in
  Millennium's config.json.

  The Steam path is discovered rather than assumed: -SteamPath, then
  $env:STEAM_PATH, then the registry (HKCU:\Software\Valve\Steam), then the
  default. Hardcoding it silently deploys nowhere on a non-default install.

.PARAMETER SteamPath
  Steam install root. Overrides discovery.

.PARAMETER NoRestart
  Build and deploy without stopping or starting Steam. Useful for frontend-only
  changes, which need just a reload (Ctrl+R in the Steam devtools).

.PARAMETER Pnpm
  Path to pnpm. Defaults to whatever is on PATH, then $env:PNPM_PATH. Useful
  when pnpm is installed locally rather than globally (corepack needs admin
  rights on some machines).

.PARAMETER SkipBuild
  Deploy whatever is already in .millennium/Dist without rebuilding.

.EXAMPLE
  pnpm dev
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File dev.ps1 -SteamPath "C:\game\steam"
#>
[CmdletBinding()]
param(
  [string] $SteamPath,
  [string] $Pnpm,
  [switch] $NoRestart,
  [switch] $SkipBuild
)

$ErrorActionPreference = 'Stop'

function Resolve-SteamPath {
  param([string] $Explicit)

  foreach ($candidate in @(
      $Explicit,
      $env:STEAM_PATH,
      $(try { (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamPath } catch { $null }),
      'C:\Program Files (x86)\Steam'
    )) {
    if ($candidate -and (Test-Path (Join-Path $candidate 'steam.exe'))) {
      return (Resolve-Path $candidate).Path
    }
  }

  throw "Could not find Steam. Pass -SteamPath or set `$env:STEAM_PATH."
}

function Resolve-Pnpm {
  param([string] $Explicit)

  foreach ($candidate in @($Explicit, $env:PNPM_PATH)) {
    if ($candidate -and (Test-Path $candidate)) { return (Resolve-Path $candidate).Path }
  }

  $onPath = Get-Command 'pnpm' -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }

  $corepack = Get-Command 'corepack' -ErrorAction SilentlyContinue
  if ($corepack) { return $corepack.Source }

  throw "Could not find pnpm. Pass -Pnpm <path>, set `$env:PNPM_PATH, or install it (npm i -g pnpm)."
}

# Windows PowerShell's -Encoding UTF8 writes a BOM, which breaks strict JSON
# parsers (Millennium's own config included). Always write UTF-8 without one.
function Write-JsonFile {
  param([string] $Path, $Object)

  $text = $Object | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText($Path, $text, (New-Object System.Text.UTF8Encoding $false))
}

function Set-PluginEnabled {
  param([string] $ConfigPath, [string] $Name, [bool] $Enabled)

  if (-not (Test-Path $ConfigPath)) {
    Write-Warning "Millennium config not found at $ConfigPath; skipping enable/disable."
    return
  }

  $json = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
  $plugins = @($json.plugins.enabledPlugins)

  if ($Enabled) {
    if ($plugins -notcontains $Name) { $plugins += $Name }
  }
  else {
    $plugins = @($plugins | Where-Object { $_ -ne $Name })
  }

  $json.plugins.enabledPlugins = @($plugins | Sort-Object -Unique)
  Write-JsonFile -Path $ConfigPath -Object $json
}

# --- resolve paths -----------------------------------------------------------

$steam = Resolve-SteamPath -Explicit $SteamPath
$configPath = Join-Path $steam 'millennium\config\config.json'
$pluginsDir = Join-Path $steam 'millennium\plugins'

$manifest = Get-Content -Path "$PSScriptRoot\plugin.json" -Raw | ConvertFrom-Json
$name = $manifest.name
$devName = "$name-dev"
$target = Join-Path $pluginsDir $devName

Write-Host "Steam:  $steam"
Write-Host "Deploy: $target"

# --- build -------------------------------------------------------------------
# The builder bakes plugin.json's `name` into the bundle, and Millennium routes
# RPC by that baked name. So the manifest must carry the dev name BEFORE the
# build, or the frontend calls "<name>" while the backend registers as
# "<name>-dev" and every call fails with "plugin not running".
#
# The source manifest is restored in the finally block below, so an interrupted
# run cannot leave the repo holding a dev name.

$manifestPath = Join-Path $PSScriptRoot 'plugin.json'
$originalManifestText = Get-Content -Path $manifestPath -Raw

try {
  $devManifest = $originalManifestText | ConvertFrom-Json
  $devManifest.name = $devName
  $devManifest.common_name = "$($devManifest.common_name) (dev)"
  Write-JsonFile -Path $manifestPath -Object $devManifest

  if ($SkipBuild) {
    Write-Host 'Skipping build (-SkipBuild).'
  }
  else {
    $pnpmExe = Resolve-Pnpm -Explicit $Pnpm
    Push-Location $PSScriptRoot
    try {
      Write-Host "Building with $pnpmExe ..."
      if ($pnpmExe -match 'corepack') {
        & $pnpmExe pnpm millennium-ttc --build dev
      }
      else {
        & $pnpmExe millennium-ttc --build dev
      }
      if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE)." }
    }
    finally {
      Pop-Location
    }
  }
}
finally {
  # Always put the real manifest back, even if the build threw.
  [System.IO.File]::WriteAllText($manifestPath, $originalManifestText)
}

if (-not (Test-Path "$PSScriptRoot\.millennium\Dist\index.js")) {
  throw 'Build produced no .millennium/Dist/index.js.'
}

# --- stop Steam --------------------------------------------------------------
# Backend (Lua) changes only take effect on restart.

if (-not $NoRestart) {
  $running = Get-Process -Name 'steam' -ErrorAction SilentlyContinue
  if ($running) {
    Write-Host 'Stopping Steam...'
    $running | Stop-Process -Force
    Start-Sleep -Seconds 3
  }
}

# --- deploy ------------------------------------------------------------------
# A deployed plugin is plugin.json + .millennium/Dist + backend. Source
# frontend/ and the _lib type stubs are not deployed.

if (Test-Path $target) { Remove-Item -Path $target -Recurse -Force }
New-Item -Path $target -ItemType Directory -Force | Out-Null

# Deploy the same dev-named manifest the bundle was built against.
Write-JsonFile -Path (Join-Path $target 'plugin.json') -Object $devManifest

Copy-Item -Path "$PSScriptRoot\.millennium" -Destination $target -Recurse -Force
Copy-Item -Path "$PSScriptRoot\backend" -Destination $target -Recurse -Force
Remove-Item -Path (Join-Path $target 'backend\_lib') -Recurse -Force -ErrorAction SilentlyContinue

Set-PluginEnabled -ConfigPath $configPath -Name $name -Enabled $false
Set-PluginEnabled -ConfigPath $configPath -Name $devName -Enabled $true

Write-Host "Deployed $devName." -ForegroundColor Green

# --- start Steam -------------------------------------------------------------
# -dev exposes the CEF devtools at http://localhost:8080.

if (-not $NoRestart) {
  Write-Host 'Starting Steam in dev mode...'
  Start-Process -FilePath (Join-Path $steam 'steam.exe') -ArgumentList '-dev', '-cef-enable-debugging'
  Write-Host 'Devtools: http://localhost:8080' -ForegroundColor Cyan
}
