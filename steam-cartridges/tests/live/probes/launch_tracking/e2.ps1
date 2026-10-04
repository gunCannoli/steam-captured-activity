# E2: the Epic wrapper shortcut. -PreLauncher starts the Epic launcher outside Steam first (case b/c); -End close|stop
# ends the game by WM_CLOSE or by Steam's Stop button. Prints only times, pids and image names (never command lines
# unredacted).
param([string]$AppId = "2631638419", [switch]$PreLauncher, [string]$End = "close", [int]$Play = 30, [int]$Watch = 75)
$lt = $PSScriptRoot
function T { (Get-Date).ToString("HH:mm:ss.fff") }
$launcher = "C:\Program Files\Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe"
if ($PreLauncher) {
  Start-Process $launcher -ArgumentList "-silent"
  "$(T) launcher started outside Steam; waiting 25 s for it to settle"
  Start-Sleep 25
  "$(T) launcher pids: " + ((Get-Process EpicGamesLauncher -ErrorAction SilentlyContinue).Id -join ",")
}
$gp0 = (Get-Content C:\game\steam\logs\gameprocess_log.txt).Count
$cl0 = (Get-Content C:\game\steam\logs\console_log.txt).Count
node "$lt\lt.mjs" run $AppId
$g = $null
for ($i = 0; $i -lt 180 -and -not $g; $i++) { Start-Sleep 1; $g = Get-Process Jotunnslayer -ErrorAction SilentlyContinue }
if (-not $g) { "$(T) game did not start in 180 s" } else {
  $ppid = (Get-CimInstance Win32_Process -Filter "ProcessId=$($g.Id)").ParentProcessId
  $pname = (Get-Process -Id $ppid -ErrorAction SilentlyContinue).Name
  "$(T) game up pid=$($g.Id) parent=$ppid ($pname)"
  Start-Sleep $Play
  if ($End -eq "stop") { "$(T) pressing Stop (TerminateApp)"; node "$lt\lt.mjs" stop $AppId }
  else { "$(T) asking the game to close (WM_CLOSE)"; $null = $g.CloseMainWindow() }
  if (-not $g.WaitForExit(25000)) { "$(T) game still alive after 25 s" } else { "$(T) game exited" }
}
node "$lt\lt.mjs" watch $AppId $Watch
"$(T) launcher pids left: " + ((Get-Process EpicGamesLauncher -ErrorAction SilentlyContinue).Id -join ",") + "; game alive: " + [bool](Get-Process Jotunnslayer -ErrorAction SilentlyContinue)
"--- steam log (new lines: tracked images only)"
Get-Content C:\game\steam\logs\gameprocess_log.txt | Select-Object -Skip $gp0 | ForEach-Object {
  if ($_ -match '^\[(.{19})\] AppID \d+ adding PID (\d+) as a tracked process "+([^"]+)') { "[$($Matches[1])] + $($Matches[2]) " + (Split-Path $Matches[3] -Leaf) }
  elseif ($_ -match 'Remove|no longer') { $_ -replace '^(.{0,120}).*$', '$1' } }
"--- console log overlay lines"
Get-Content C:\game\steam\logs\console_log.txt | Select-Object -Skip $cl0 | Where-Object { $_ -match 'GameOverlay' }
