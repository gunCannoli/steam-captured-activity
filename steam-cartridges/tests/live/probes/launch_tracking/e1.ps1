# E1: reaper prototype on Jotunnslayer. Starts the reaper (outside Steam), runs the LT shortcut, quits the game after 30 s,
# watches Steam's running state. No command line of any process is printed.
param([string]$AppId = "3532260871", [switch]$NoReap, [int]$Play = 30)
$lt = $PSScriptRoot
$root = "C:\Program Files\Epic Games\JotunnslayerHordesofrI2Zp"
function T { (Get-Date).ToString("HH:mm:ss.fff") }
$since = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
if (-not $NoReap) {
  Start-Process -FilePath "$lt\ltprobe.exe" -ArgumentList @("reap", "--root", "`"$root`"", "--app", "05cc03868360490aa4d7138723f4d99e", "--since", "$since", "--grace", "30", "--timeout", "300")
  "$(T) reaper started"
}
$gp0 = (Get-Content C:\game\steam\logs\gameprocess_log.txt).Count
node "$lt\lt.mjs" run $AppId
$g = $null
for ($i = 0; $i -lt 180 -and -not $g; $i++) { Start-Sleep 1; $g = Get-Process Jotunnslayer -ErrorAction SilentlyContinue }
if (-not $g) { "$(T) game did not start in 180 s"; exit 2 }
"$(T) game up pid=$($g.Id)"
Start-Sleep $Play
"$(T) asking the game to close (WM_CLOSE)"
$null = $g.CloseMainWindow()
if (-not $g.WaitForExit(20000)) { "$(T) game ignored WM_CLOSE; Stop-Process"; Stop-Process -Id $g.Id -Force; $g.WaitForExit(5000) | Out-Null }
"$(T) game exited"
node "$lt\lt.mjs" watch $AppId 75
"$(T) epic launcher processes left: " + @(Get-Process EpicGamesLauncher -ErrorAction SilentlyContinue).Count
"--- steam log (redacted, new lines)"
Get-Content C:\game\steam\logs\gameprocess_log.txt | Select-Object -Skip $gp0 | ForEach-Object { ($_ -replace '(-AUTH_PASSWORD=)\S+', '$1<redacted>') -replace '^(.{0,170}).*$', '$1' }
"--- launcher log cloud sync (UTC)"
Select-String -Path "$env:LOCALAPPDATA\EpicGamesLauncher\Saved\Logs\EpicGamesLauncher.log" -Pattern 'Cloud Sync: Upload Complete' | Select-Object -Last 2 | ForEach-Object { $_.Line.Substring(0, [Math]::Min(160, $_.Line.Length)) }
