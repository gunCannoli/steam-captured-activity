# E9: the shipped Epic Steam Overlay Workaround (ADR-0057), with no help from this script: the Epic launcher is opened as
# from the tray, Steam's own Play button is clicked on a real Epic shortcut's page, then the game is closed. Checks: the
# plugin closed the launcher before the launch, the game is in Steam's tree with the overlay, and the plugin ended the
# launcher after the game (entry leaves the running list). Prints no command lines. Needs the Steam lock and the setting on.
param([string]$AppId = "4202674849", [string]$Image = "Jotunnslayer", [int]$Play = 25)
$lt = $PSScriptRoot
function T { (Get-Date).ToString("HH:mm:ss.fff") }
function J([string]$e) { node "$lt\lt.mjs" eval $e }
$launcher = "C:\Program Files\Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe"
Start-Process $launcher -ArgumentList "-silent"
"$(T) Epic launcher opened outside Steam; settling 25 s"
Start-Sleep 25
"$(T) launcher pids before Play: " + ((Get-Process EpicGamesLauncher -ErrorAction SilentlyContinue).Id -join ",")
$js0 = (Get-Content C:\game\steam\logs\webhelper_js.txt).Count
$gp0 = (Get-Content C:\game\steam\logs\gameprocess_log.txt).Count
$cl0 = (Get-Content C:\game\steam\logs\console_log.txt).Count
J "(()=>{const w=SteamUIStore.WindowStore.SteamUIWindows.find(w=>w.Navigator?.AppProperties);w.Navigator.App($AppId);return 'page opened'})()"
Start-Sleep 5
"$(T) " + (J "(()=>{const w=SteamUIStore.WindowStore.SteamUIWindows.find(w=>w.Navigator?.AppProperties);const b=w.m_BrowserWindow.document.querySelector('.PlayButton');if(!b)return 'no Play button';b.click();return 'clicked Play'})()")
$g = $null
for ($i = 0; $i -lt 120 -and -not $g; $i++) { Start-Sleep 1; $g = Get-Process $Image -ErrorAction SilentlyContinue | Select-Object -First 1 }
if (-not $g) { "$(T) the game did not start in 120 s" } else {
  $pp = (Get-CimInstance Win32_Process -Filter "ProcessId=$($g.Id)").ParentProcessId
  "$(T) game up pid=$($g.Id) parent=$pp"
  Start-Sleep $Play
  "--- overlay lines"
  Get-Content C:\game\steam\logs\console_log.txt | Select-Object -Skip $cl0 | Where-Object { $_ -match 'GameOverlay' }
  "$(T) WM_CLOSE"; $null = $g.CloseMainWindow(); $null = $g.WaitForExit(20000); "$(T) game exited"
}
node "$lt\lt.mjs" watch $AppId 60
"launchers left: " + @(Get-Process EpicGamesLauncher -ErrorAction SilentlyContinue).Count
"--- Steam: tracked game and running list"
Get-Content C:\game\steam\logs\gameprocess_log.txt | Select-Object -Skip $gp0 | ForEach-Object {
  if ($_ -match '^\[(.{19})\] AppID \d+ adding PID (\d+) as a tracked process "+([^"]+)') { $leaf = Split-Path $Matches[3] -Leaf; if ($leaf -match "EpicGamesLauncher|$Image") { "[$($Matches[1])] + $($Matches[2]) $leaf" } }
  elseif ($_ -match 'Remove') { $_ } }
"--- plugin log"
Get-Content C:\game\steam\logs\webhelper_js.txt | Select-Object -Skip $js0 | Where-Object { $_ -match 'Epic overlay workaround' } | ForEach-Object { $_ -replace '^(.{0,60}).*?(Epic overlay workaround.*)$', '$1 $2' } | ForEach-Object { $_.Substring(0, [Math]::Min(220, $_.Length)) }
