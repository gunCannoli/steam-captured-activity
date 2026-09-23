<#
.SYNOPSIS
  Build steamgriddb-artwork and deploy it to a live Millennium install as a parallel
  "-dev" copy, then restart Steam.

.DESCRIPTION
  Deploys as "<name>-dev" so a released copy of the plugin stays installed and
  untouched. The released one is disabled and the dev one enabled in
  Millennium's config.json.
#>
[CmdletBinding()]
param(
  [string] $SteamPath,
  [switch] $NoRestart,
  [switch] $SkipBuild
)

$ErrorActionPreference = 'Stop'

function Resolve-SteamPath {
  param([string] $Explicit)

  foreach ($candidate in @(
      $Explicit,
      $env:STEAM_PATH,
      'C:\game\steam',
      $(try { (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamPath } catch { $null }),
      'C:\Program Files (x86)\Steam'
    )) {
    if ($candidate -and (Test-Path (Join-Path $candidate 'steam.exe'))) {
      return (Resolve-Path $candidate).Path
    }
  }

  throw "Could not find Steam. Pass -SteamPath or set `$env:STEAM_PATH."
}

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
    Push-Location $PSScriptRoot
    try {
      Write-Host "Building frontend bundle..."
      npx millennium-ttc --build dev
      if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE)." }
    }
    finally {
      Pop-Location
    }
  }
}
finally {
  [System.IO.File]::WriteAllText($manifestPath, $originalManifestText)
}

if (-not (Test-Path "$PSScriptRoot\.millennium\Dist\index.js")) {
  throw 'Build produced no .millennium/Dist/index.js.'
}

# --- stop Steam --------------------------------------------------------------

if (-not $NoRestart) {
  $running = Get-Process -Name 'steam' -ErrorAction SilentlyContinue
  if ($running) {
    Write-Host 'Stopping Steam...'
    $running | Stop-Process -Force
    Start-Sleep -Seconds 3
  }
}

# --- deploy ------------------------------------------------------------------

if (Test-Path $target) { Remove-Item -Path $target -Recurse -Force }
New-Item -Path $target -ItemType Directory -Force | Out-Null

Write-JsonFile -Path (Join-Path $target 'plugin.json') -Object $devManifest

Copy-Item -Path "$PSScriptRoot\.millennium" -Destination $target -Recurse -Force
Copy-Item -Path "$PSScriptRoot\backend" -Destination $target -Recurse -Force
Remove-Item -Path (Join-Path $target 'backend\_lib') -Recurse -Force -ErrorAction SilentlyContinue

Set-PluginEnabled -ConfigPath $configPath -Name $name -Enabled $false
Set-PluginEnabled -ConfigPath $configPath -Name $devName -Enabled $true

Write-Host "Deployed $devName." -ForegroundColor Green

# --- start Steam -------------------------------------------------------------

if (-not $NoRestart) {
  Write-Host 'Starting Steam in dev mode...'
  Start-Process -FilePath (Join-Path $steam 'steam.exe') -ArgumentList '-dev', '-cef-enable-debugging'
  $steamExe = Join-Path $steam 'steam.exe'
  try {
    Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
      CommandLine      = "`"$steamExe`" -dev -cef-enable-debugging"
      CurrentDirectory = $steam
    } -ErrorAction Stop | Out-Null
  }
  catch {
    Start-Process -FilePath $steamExe -ArgumentList '-dev', '-cef-enable-debugging' -WorkingDirectory $steam
  }
  Write-Host 'Devtools: http://localhost:8080' -ForegroundColor Cyan
}

