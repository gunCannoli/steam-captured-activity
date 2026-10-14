# E5: Fortress Merge from a direct-exe LT shortcut. Tree, overlay, package identity, Xbox Live connections, recording control.
param([string]$AppId, [int]$Play = 25)
$lt = $PSScriptRoot
function T { (Get-Date).ToString("HH:mm:ss.fff") }
$gp0 = (Get-Content C:\game\steam\logs\gameprocess_log.txt).Count
$cl0 = (Get-Content C:\game\steam\logs\console_log.txt).Count
node "$lt\lt.mjs" run $AppId
$g = $null
for ($i = 0; $i -lt 60 -and -not $g; $i++) { Start-Sleep 1; $g = Get-Process -Name "Fortress Merge" -ErrorAction SilentlyContinue | Select-Object -First 1 }
if (-not $g) { "$(T) the game did not start in 60 s" } else {
  $w = Get-CimInstance Win32_Process -Filter "ProcessId=$($g.Id)"
  "$(T) game up pid=$($g.Id) parent=$($w.ParentProcessId) ($((Get-Process -Id $w.ParentProcessId -ErrorAction SilentlyContinue).Name)) path=$($w.ExecutablePath)"
  $pr = Start-Process (Join-Path $lt "ltprobe.exe") -ArgumentList @("pkgof", "$($g.Id)") -PassThru; $null = $pr.WaitForExit(5000)
  Get-Content (Join-Path $lt "ltprobe.log") | Select-Object -Last 1
  Start-Sleep 10
  node "$lt\lt.mjs" state $AppId
  node "$lt\lt.mjs" rec $AppId start | ForEach-Object { $_.Substring(0, [Math]::Min(60, $_.Length)) }
  Start-Sleep 8
  node "$lt\lt.mjs" state $AppId
  node "$lt\lt.mjs" rec $AppId stop
  $conns = Get-NetTCPConnection -OwningProcess $g.Id -State Established -ErrorAction SilentlyContinue
  "$(T) game TCP connections: " + @($conns).Count + " -> " + (($conns | ForEach-Object { $_.RemoteAddress } | Sort-Object -Unique) -join ",")
  $dns = Get-DnsClientCache -ErrorAction SilentlyContinue | Where-Object { $_.Entry -match 'xboxlive|xsts|playfab' } | ForEach-Object { $_.Entry } | Sort-Object -Unique
  "$(T) Xbox-related names in the DNS cache: " + ($dns -join ",")
  Start-Sleep $Play
  "$(T) WM_CLOSE"; $null = $g.CloseMainWindow()
  if (-not $g.WaitForExit(15000)) { "$(T) ignored WM_CLOSE; Stop-Process"; Stop-Process -Id $g.Id -Force }
}
node "$lt\lt.mjs" watch $AppId 20
"--- steam log (new lines: tracked images only)"
Get-Content C:\game\steam\logs\gameprocess_log.txt | Select-Object -Skip $gp0 | ForEach-Object {
  if ($_ -match '^\[(.{19})\] AppID \d+ adding PID (\d+) as a tracked process "+([^"]+)') { "[$($Matches[1])] + $($Matches[2]) " + (Split-Path $Matches[3] -Leaf) }
  elseif ($_ -match 'Remove') { $_ } }
"--- console log overlay lines"
Get-Content C:\game\steam\logs\console_log.txt | Select-Object -Skip $cl0 | Where-Object { $_ -match 'GameOverlay' }
