<#
.SYNOPSIS
  Starts or restarts Steam in -dev mode with CEF remote debugging enabled.

.DESCRIPTION
  Ensures Steam is running with `-dev -cef-enable-debugging`, exposing the Chrome
  DevTools Protocol (CDP) on http://localhost:8080.

  Discovers the Steam installation automatically across parameters, environment
  variables, Windows registry, and known paths (e.g. C:\game\steam).

  Can also launch directly into Big Picture Mode (-BigPicture) or open the
  DevTools target inspector in your browser (-OpenBrowser).

.PARAMETER SteamPath
  Explicit path to the Steam directory. Overrides auto-discovery.

.PARAMETER Restart
  Forces restarting Steam even if it is already running.

.PARAMETER BigPicture
  Launches Steam directly in Big Picture Mode (-gamepadui).

.PARAMETER OpenBrowser
  Opens http://localhost:8080/ in your default browser once debugging is ready.

.PARAMETER Port
  The CEF debugging port. Defaults to 8080.

.PARAMETER KillOnly
  Stops any running Steam process without starting a new one.

.EXAMPLE
  .\start-steam-dev.ps1
  Checks if Steam is running with debugging; if not, starts Steam in -dev mode.

.EXAMPLE
  .\start-steam-dev.ps1 -Restart -OpenBrowser
  Restarts Steam with debugging and opens http://localhost:8080 in the browser.

.EXAMPLE
  .\start-steam-dev.ps1 -BigPicture
  Launches Steam in Big Picture / Gamepad UI mode with debugging enabled.
#>
[CmdletBinding()]
param(
  [string] $SteamPath,
  [switch] $Restart,
  [switch] $BigPicture,
  [switch] $OpenBrowser,
  [int]    $Port = 8080,
  [switch] $KillOnly
)

$ErrorActionPreference = 'Stop'

function Resolve-SteamPath {
  param([string] $Explicit)

  $candidates = @(
    $Explicit,
    $env:STEAM_PATH,
    $(try { (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamPath } catch { $null }),
    'C:\game\steam',
    'C:\Program Files (x86)\Steam'
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path (Join-Path $candidate 'steam.exe'))) {
      return (Resolve-Path $candidate).Path
    }
  }

  throw 'Could not find steam.exe. Specify -SteamPath or set $env:STEAM_PATH.'
}

function Test-CefDebugging {
  param([int] $DebugPort)
  try {
    # Query 127.0.0.1 /json directly (avoiding IPv6 resolution and missing /json/version endpoint)
    $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$DebugPort/json" -TimeoutSec 2 -ErrorAction Stop
    return $null -ne $resp
  }
  catch {
    return $false
  }
}

function Start-SteamProcess {
  param(
    [string]$ExePath,
    [string]$ArgumentString,
    [string]$WorkingDirectory
  )
  try {
    # Launch detached via WMI so Steam survives script/job termination
    $res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
      CommandLine      = "`"$ExePath`" $ArgumentString"
      CurrentDirectory = $WorkingDirectory
    } -ErrorAction Stop
    if ($res.ReturnValue -ne 0) {
      throw "WMI Win32_Process.Create returned $($res.ReturnValue)"
    }
  }
  catch {
    # Fallback to Start-Process
    Start-Process -FilePath $ExePath -ArgumentList $ArgumentString -WorkingDirectory $WorkingDirectory
  }
}

$steamDir = Resolve-SteamPath -Explicit $SteamPath
$steamExe = Join-Path $steamDir 'steam.exe'
Write-Host "Steam Path: $steamExe" -ForegroundColor DarkGray

# 1. Check running process status
$running = Get-Process -Name 'steam', 'steamwebhelper' -ErrorAction SilentlyContinue
$portResponding = Test-CefDebugging -DebugPort $Port

if ($KillOnly) {
  if ($running) {
    Write-Host 'Stopping Steam...' -ForegroundColor Yellow
    $running | Stop-Process -Force
    Start-Sleep -Seconds 2
    Write-Host 'Steam stopped.' -ForegroundColor Green
  }
  else {
    Write-Host 'Steam is not running.' -ForegroundColor Gray
  }
  return
}

$needsRestart = $Restart -or ($running -and -not $portResponding)

if ($needsRestart) {
  if ($running) {
    if (-not $Restart -and -not $portResponding) {
      Write-Host "Steam is running, but port $Port is NOT responding to debugging." -ForegroundColor Yellow
    }
    Write-Host 'Stopping existing Steam processes...' -ForegroundColor Yellow
    $running | Stop-Process -Force
    Start-Sleep -Seconds 3
  }
}
elseif ($running -and $portResponding) {
  Write-Host "Steam is already running with CEF debugging active on port $Port." -ForegroundColor Green
}

# 2. Start Steam if not running or restarted
$runningNow = Get-Process -Name 'steam' -ErrorAction SilentlyContinue
if (-not $runningNow) {
  $argList = @('-dev', '-cef-enable-debugging')
  if ($BigPicture) {
    $argList += '-gamepadui'
    Write-Host "Starting Steam in Big Picture mode with debugging on port $Port..." -ForegroundColor Cyan
  }
  else {
    Write-Host "Starting Steam in dev mode with debugging on port $Port..." -ForegroundColor Cyan
  }

  Start-SteamProcess -ExePath $steamExe -ArgumentString ($argList -join ' ') -WorkingDirectory $steamDir
}

# 3. Wait for port to become responsive
Write-Host "Waiting for CEF DevTools at http://127.0.0.1:$Port/ ..." -NoNewline
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  Write-Host '.' -NoNewline
  if (Test-CefDebugging -DebugPort $Port) {
    $ready = $true
    break
  }
}
Write-Host ''

if (-not $ready) {
  Write-Warning "CEF debugging did not become responsive on port $Port within 60 seconds."
  Write-Host 'Check if Steam launched properly or if a firewall is blocking port 8080.' -ForegroundColor Red
  return
}

Write-Host "`n=== CEF DevTools Ready on http://localhost:$Port/ ===" -ForegroundColor Green

# 4. Enumerate active targets
try {
  $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json" -TimeoutSec 6
  if ($targets) {
    Write-Host "`nActive Targets:" -ForegroundColor Cyan
    foreach ($t in $targets) {
      $marker = '  '
      if ($t.title -eq 'SharedJSContext') {
        $marker = '* ' # Main runtime context where stores, section patches, and portals live
      }
      elseif ($t.title -match 'Big Picture') {
        $marker = '> '
      }
      Write-Host ("{0}[{1,-15}] {2}" -f $marker, $t.type, $t.title) -ForegroundColor White
      Write-Host ("   URL: {0}" -f $t.url) -ForegroundColor DarkGray
      Write-Host ("   WS:  {0}" -f $t.webSocketDebuggerUrl) -ForegroundColor DarkGray
    }
    Write-Host "`n(*) SharedJSContext: Single runtime where all stores and Big Picture portals run." -ForegroundColor DarkCyan
    Write-Host "See docs/steam-debug.md for target traps, console filters, and Big Picture quirks.`n" -ForegroundColor DarkGray
  }
}
catch {
  Write-Host "Could not query target list from http://localhost:$Port/json." -ForegroundColor DarkYellow
}

if ($OpenBrowser) {
  Write-Host "Opening http://localhost:$Port/ in default browser..." -ForegroundColor Cyan
  Start-Process "http://localhost:$Port/"
}

