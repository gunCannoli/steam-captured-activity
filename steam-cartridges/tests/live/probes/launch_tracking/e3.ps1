# E3/E4/E5 runner: run an LT shortcut, wait for a process named $Image, try a manual recording, end it by -End kill|stop|close.
param([string]$AppId, [string]$Image, [string]$End = "kill", [int]$Play = 20, [int]$Watch = 40, [switch]$Record)
$lt = $PSScriptRoot
function T { (Get-Date).ToString("HH:mm:ss.fff") }
$gp0 = (Get-Content C:\game\steam\logs\gameprocess_log.txt).Count
$cl0 = (Get-Content C:\game\steam\logs\console_log.txt).Count
node "$lt\lt.mjs" run $AppId
$g = $null
for ($i = 0; $i -lt 60 -and -not $g; $i++) { Start-Sleep 1; $g = Get-Process $Image -ErrorAction SilentlyContinue | Select-Object -First 1 }
if (-not $g) { "$(T) $Image did not start in 60 s" } else {
  $ppid = (Get-CimInstance Win32_Process -Filter "ProcessId=$($g.Id)").ParentProcessId
  "$(T) $Image up pid=$($g.Id) parent=$ppid ($((Get-Process -Id $ppid -ErrorAction SilentlyContinue).Name))"
  Start-Sleep 5
  node "$lt\lt.mjs" state $AppId
  if ($Record) { node "$lt\lt.mjs" rec $AppId start; Start-Sleep 8; node "$lt\lt.mjs" state $AppId; node "$lt\lt.mjs" rec $AppId stop }
  Start-Sleep $Play
  switch ($End) {
    "stop" { "$(T) pressing Stop"; node "$lt\lt.mjs" stop $AppId }
    "close" { "$(T) WM_CLOSE"; $null = $g.CloseMainWindow() }
    default { "$(T) ending $Image (Stop-Process)"; Stop-Process -Id $g.Id -Force }
  }
}
node "$lt\lt.mjs" watch $AppId $Watch
"$(T) $Image alive: " + [bool](Get-Process $Image -ErrorAction SilentlyContinue)
"--- steam log (new lines: tracked images only)"
Get-Content C:\game\steam\logs\gameprocess_log.txt | Select-Object -Skip $gp0 | ForEach-Object {
  if ($_ -match '^\[(.{19})\] AppID \d+ adding PID (\d+) as a tracked process "+([^"]+)') { "[$($Matches[1])] + $($Matches[2]) " + (Split-Path $Matches[3] -Leaf) }
  elseif ($_ -match 'Remove|no longer') { $_ -replace '^(.{0,120}).*$', '$1' } }
"--- console log overlay lines"
Get-Content C:\game\steam\logs\console_log.txt | Select-Object -Skip $cl0 | Where-Object { $_ -match 'GameOverlay' }
