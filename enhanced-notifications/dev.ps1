<#
.SYNOPSIS
  Build this plugin and deploy it to a live Millennium install as a parallel
  "-dev" copy, then restart Steam. Or, with -Release / -Package, build and
  deploy/zip it under its real name for an alpha install.

.DESCRIPTION
  Default (no switches): deploys as "<name>-dev" so a released copy of the
  plugin stays installed and untouched. The released one is disabled and the
  dev one enabled in Millennium's config.json.

  The Steam path is discovered rather than assumed: -SteamPath, then
  $env:STEAM_PATH, then the registry (HKCU:\Software\Valve\Steam), then the
  default. Hardcoding it silently deploys nowhere on a non-default install.

.PARAMETER SteamPath
  Steam install root. Overrides discovery.

.PARAMETER NoRestart
  Build and deploy without stopping or starting Steam. Useful for frontend-only
  changes, which need just a reload (Ctrl+R in the Steam devtools).

.PARAMETER SkipBuild
  Deploy whatever is already in .millennium/Dist without rebuilding.

.PARAMETER Release
  Build with the real (un-rewritten) name, deploy to plugins/<name>, enable
  it, and disable <name>-dev. Uses the same file set as the dev deploy
  (plugin.json, .millennium/, backend/ minus _lib, themes/).

.PARAMETER Package
  Build with the real name and zip that file set into dist/<name>-<version>.zip
  (top folder <name>/). dist/ is gitignored. Implies a prod build; does not
  touch a live Steam install unless -Release is also passed.

.EXAMPLE
  npm run dev
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File dev.ps1 -SteamPath "C:\game\steam"
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File dev.ps1 -Release
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File dev.ps1 -Package
#>
[CmdletBinding()]
param(
  [string] $SteamPath,
  [switch] $NoRestart,
  [switch] $SkipBuild,
  [switch] $Release,
  [switch] $Package
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

# Stop Steam cleanly: ask it to exit, then wait for every steamwebhelper too.
# Force-killing only steam.exe leaves its webhelper windows running into the
# next Steam start. CEF keeps a list of in-app routes (/routes/library/...) it
# treated as file downloads and re-rejects them at every start (cef_log.txt,
# "Rejected download of ..."), which is suspected to relate to the occasional
# "Save as" dialog (not reproduced; see docs/plugins.md § 4). Force-kill only
# as a fallback, helpers included.
function Stop-Steam {
  param([string] $SteamExe, [int] $TimeoutSeconds = 30)

  if (-not (Get-Process -Name 'steam', 'steamwebhelper' -ErrorAction SilentlyContinue)) { return }

  Write-Host 'Shutting Steam down...'
  if (Get-Process -Name 'steam' -ErrorAction SilentlyContinue) {
    Start-Process -FilePath $SteamExe -ArgumentList '-shutdown'
  }

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Process -Name 'steam', 'steamwebhelper' -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
  }

  $left = Get-Process -Name 'steam', 'steamwebhelper' -ErrorAction SilentlyContinue
  if ($left) {
    Write-Warning "Steam did not exit within $TimeoutSeconds s; force-stopping it."
    $left | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
}

# The deployed file set (plugin.json, .millennium/Dist, backend minus _lib,
# themes). Source frontend/, examples/, research/ and tests/ are never deployed
# or packaged.
function Copy-PluginFiles {
  param([string] $SourceRoot, [string] $Target, [pscustomobject] $Manifest)

  if (Test-Path $Target) { Remove-Item -Path $Target -Recurse -Force }
  New-Item -Path $Target -ItemType Directory -Force | Out-Null

  Write-JsonFile -Path (Join-Path $Target 'plugin.json') -Object $Manifest
  Copy-Item -Path (Join-Path $SourceRoot '.millennium') -Destination $Target -Recurse -Force
  Copy-Item -Path (Join-Path $SourceRoot 'backend') -Destination $Target -Recurse -Force
  Copy-Item -Path (Join-Path $SourceRoot 'themes') -Destination $Target -Recurse -Force
  Remove-Item -Path (Join-Path $Target 'backend\_lib') -Recurse -Force -ErrorAction SilentlyContinue
}

# --- resolve paths -----------------------------------------------------------

$steam = Resolve-SteamPath -Explicit $SteamPath
$configPath = Join-Path $steam 'millennium\config\config.json'
$pluginsDir = Join-Path $steam 'millennium\plugins'

$manifest = Get-Content -Path "$PSScriptRoot\plugin.json" -Raw | ConvertFrom-Json
$name = $manifest.name
# A force-killed run skips the finally block that restores plugin.json and leaves the
# dev name in it; building again would deploy "<name>-dev-dev" (seen 2026-10-01).
if ($name -like '*-dev') {
  throw "plugin.json name is '$name': an interrupted dev.ps1 left the dev name in it. Run: git checkout -- plugin.json"
}
$devName = "$name-dev"
$releaseMode = $Release -or $Package
$deployName = if ($releaseMode) { $name } else { $devName }
$target = Join-Path $pluginsDir $deployName

Write-Host "Steam:  $steam"
if ($Release) { Write-Host "Deploy: $target (release)" }
if ($Package) { Write-Host "Package: dist\$name-$($manifest.version).zip" }
if (-not $releaseMode) { Write-Host "Deploy: $target" }

# --- steam lock ----------------------------------------------------------------
# One agent at a time deploys or restarts Steam (AGENTS.md, "Sharing the live Steam
# client"). Waits up to 15 min for another holder. Re-entrant: when the caller already
# holds the lock (STEAM_LOCK_OWNER, or inside `steam-lock.mjs run`) it does not wait,
# and only a lock taken here is released here. Absent in a plugin's public repo.
$lockScript = Join-Path $PSScriptRoot '..\steam-lock.mjs'
$lockOwner = if ($env:STEAM_LOCK_OWNER) { $env:STEAM_LOCK_OWNER } else { "dev.ps1-$deployName-$PID" }
$ownLock = $false
if (-not ($Package -and -not $Release) -and (Test-Path $lockScript) -and (Get-Command node -ErrorAction SilentlyContinue)) {
  node $lockScript acquire --owner $lockOwner --purpose "deploy $deployName (dev.ps1)" --wait 900
  if ($LASTEXITCODE -eq 1) { throw 'Steam is in use by another agent (steam-lock above); try again when it is free.' }
  $ownLock = ($LASTEXITCODE -eq 0)
}
# A failure anywhere below still frees the lock (a force-kill does not: the lock expires).
trap { if ($ownLock) { node $lockScript release --owner $lockOwner | Out-Null }; break }

# --- build -------------------------------------------------------------------
# The builder bakes plugin.json's `name` into the bundle, and Millennium routes
# RPC by that baked name. So the manifest must carry the deploy name BEFORE the
# build, or the frontend calls "<name>" while the backend registers under a
# different name and every call fails with "plugin not running".
#
# The source manifest is restored in the finally block below, so an interrupted
# run cannot leave the repo holding a rewritten name.

$manifestPath = Join-Path $PSScriptRoot 'plugin.json'
$originalManifestText = Get-Content -Path $manifestPath -Raw

try {
  $buildManifest = $originalManifestText | ConvertFrom-Json
  if (-not $releaseMode) {
    $buildManifest.name = $devName
    $buildManifest.common_name = "$($buildManifest.common_name) (dev)"
    Write-JsonFile -Path $manifestPath -Object $buildManifest
  }

  if ($SkipBuild) {
    Write-Host 'Skipping build (-SkipBuild).'
  }
  else {
    Push-Location $PSScriptRoot
    try {
      $buildKind = if ($releaseMode) { 'prod' } else { 'dev' }
      Write-Host "Building with npx millennium-ttc (--build $buildKind) ..."
      & npx millennium-ttc --build $buildKind
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

# --- package -------------------------------------------------------------------

if ($Package) {
  $distDir = Join-Path $PSScriptRoot 'dist'
  New-Item -Path $distDir -ItemType Directory -Force | Out-Null
  $stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) "millennium-pkg-$([guid]::NewGuid())"
  $stageTarget = Join-Path $stageRoot $name
  try {
    Copy-PluginFiles -SourceRoot $PSScriptRoot -Target $stageTarget -Manifest $buildManifest
    $zipPath = Join-Path $distDir "$name-$($buildManifest.version).zip"
    if (Test-Path $zipPath) { Remove-Item -Path $zipPath -Force }
    Compress-Archive -Path $stageTarget -DestinationPath $zipPath -CompressionLevel Optimal
    Write-Host "Packaged $zipPath" -ForegroundColor Green
  }
  finally {
    Remove-Item -Path $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if (-not $Release) {
  if (-not $Package) {
    # Fall through to the default -dev deploy below.
  }
  else {
    if ($ownLock) { node $lockScript release --owner $lockOwner | Out-Null }
    exit 0
  }
}

# --- stop Steam --------------------------------------------------------------
# Backend (Lua) changes only take effect on restart.

if (-not $NoRestart) {
  Stop-Steam -SteamExe (Join-Path $steam 'steam.exe')
}

# --- deploy ------------------------------------------------------------------
# A deployed plugin is plugin.json + .millennium/Dist + backend + themes. Source
# frontend/ and the _lib type stubs are not deployed.
# settings.json is bundled into the frontend at build time.

Copy-PluginFiles -SourceRoot $PSScriptRoot -Target $target -Manifest $buildManifest

if ($Release) {
  Set-PluginEnabled -ConfigPath $configPath -Name $devName -Enabled $false
  Set-PluginEnabled -ConfigPath $configPath -Name $name -Enabled $true
}
else {
  Set-PluginEnabled -ConfigPath $configPath -Name $name -Enabled $false
  Set-PluginEnabled -ConfigPath $configPath -Name $devName -Enabled $true
}

Write-Host "Deployed $deployName." -ForegroundColor Green

# --- start Steam -------------------------------------------------------------
# -dev exposes the CEF devtools at http://localhost:8080.

if (-not $NoRestart) {
  Write-Host 'Starting Steam in dev mode...'
  Start-Process -FilePath (Join-Path $steam 'steam.exe') -ArgumentList '-dev', '-cef-enable-debugging'
  Write-Host 'Devtools: http://localhost:8080' -ForegroundColor Cyan

  # Boot health (workspace only; absent in a plugin's public repo): the UI rendered and
  # every enabled plugin loaded. A failure here means this deploy broke Steam's start.
  $health = Join-Path $PSScriptRoot '..\steam-health.mjs'
  if ((Test-Path $health) -and (Get-Command node -ErrorAction SilentlyContinue)) {
    node $health --wait 120 --steam $steam
    if ($LASTEXITCODE -ne 0) {
      Write-Warning 'Steam boot health check failed after this deploy (FAIL lines above).'
      if ($ownLock) { node $lockScript release --owner $lockOwner | Out-Null }
      exit 1
    }
  }
}

if ($ownLock) { node $lockScript release --owner $lockOwner | Out-Null }
