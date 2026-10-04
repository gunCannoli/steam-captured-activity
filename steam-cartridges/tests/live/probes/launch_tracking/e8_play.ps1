# E8: Play interception (the user's choice, 2026-10-03). The Epic launcher is open (as from the tray); Steam's own Play button is
# clicked on an LT shortcut's page; a temporary wrap of SteamClient.Apps.RunGame holds the launch while this script (standing in for
# the plugin's backend) closes the launcher, then lets Steam launch. Checks: the game in Steam's tree, the overlay line, and the
# reaper (R) ending the launcher after the game. The wrap is removed at the end, also on failure. Prints no command lines.
param([string]$AppId = "2539325584", [int]$Play = 20)
$lt = $PSScriptRoot
function T { (Get-Date).ToString("HH:mm:ss.fff") }
function J([string]$e) { node "$lt\lt.mjs" eval $e }
$gid = ([UInt64]$AppId -shl 32) -bor 0x02000000
$launcher = "C:\Program Files\Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe"
$root = "C:\Program Files\Epic Games\JotunnslayerHordesofrI2Zp"
try {
  Start-Process $launcher -ArgumentList "-silent"
  "$(T) Epic launcher opened outside Steam (as from the tray); settling 25 s"
  Start-Sleep 25
  "$(T) launcher pids: " + ((Get-Process EpicGamesLauncher -ErrorAction SilentlyContinue).Id -join ",")
  $since = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  Start-Process -FilePath "$lt\ltprobe.exe" -ArgumentList @("reap", "--root", "`"$root`"", "--app", "05cc03868360490aa4d7138723f4d99e", "--since", "$since", "--grace", "30", "--timeout", "300")
  J "(()=>{const A=SteamClient.Apps;if(!window.__ltOrigRunGame)window.__ltOrigRunGame=A.RunGame;const orig=window.__ltOrigRunGame;window.__ltPlay=null;A.RunGame=function(g,...r){if(String(g)!=='$gid')return orig.call(A,g,...r);window.__ltPlay={at:Date.now()};new Promise(res=>{window.__ltGo=res}).then(()=>{window.__ltPlay.launched=Date.now();orig.call(A,g,...r)});};return 'wrap installed'})()"
  J "(()=>{const w=SteamUIStore.WindowStore.SteamUIWindows.find(w=>w.Navigator?.AppProperties);w.Navigator.App($AppId);return 'page opened'})()"
  Start-Sleep 5
  $gp0 = (Get-Content C:\game\steam\logs\gameprocess_log.txt).Count
  $cl0 = (Get-Content C:\game\steam\logs\console_log.txt).Count
  "$(T) " + (J "(()=>{const w=SteamUIStore.WindowStore.SteamUIWindows.find(w=>w.Navigator?.AppProperties);const d=w.m_BrowserWindow.document;const h=d.body.innerText.includes('LT-Jotunnslayer play');const b=d.querySelector('.PlayButton');if(!b)return 'no Play button';b.click();return 'clicked Play (page is the LT shortcut: '+h+')'})()")
  $seen = $false
  for ($i = 0; $i -lt 40 -and -not $seen; $i++) { Start-Sleep -Milliseconds 250; $seen = (J "(()=>!!window.__ltPlay)()") -eq "True" }
  if (-not $seen) { "$(T) RunGame was NOT called through the wrap"; return }
  "$(T) the wrap caught Steam's RunGame (launch held)"
  $pend = @(Get-ChildItem C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests\Pending -ErrorAction SilentlyContinue).Count
  $inc = @(Select-String -Path C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests\*.item -Pattern '"bIsIncompleteInstall"\s*:\s*true' -ErrorAction SilentlyContinue).Count
  if ($pend -or $inc) { "$(T) download pending: launcher left open" } else {
    taskkill /T /F /IM EpicGamesLauncher.exe | Out-Null
    for ($i = 0; $i -lt 40 -and (Get-Process EpicGamesLauncher -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 100 }
    "$(T) launcher closed"
  }
  J "(()=>{window.__ltGo();return 'launch released'})()"
  $g = $null
  for ($i = 0; $i -lt 120 -and -not $g; $i++) { Start-Sleep 1; $g = Get-Process Jotunnslayer -ErrorAction SilentlyContinue }
  if (-not $g) { "$(T) the game did not start in 120 s"; return }
  $pp = (Get-CimInstance Win32_Process -Filter "ProcessId=$($g.Id)").ParentProcessId
  "$(T) game up pid=$($g.Id) parent=$pp; hold " + (J "(()=>window.__ltPlay.launched-window.__ltPlay.at)()") + " ms between Play and Steam's launch"
  Start-Sleep $Play
  "--- tracked (Steam log)"
  Get-Content C:\game\steam\logs\gameprocess_log.txt | Select-Object -Skip $gp0 | ForEach-Object {
    if ($_ -match '^\[(.{19})\] AppID \d+ adding PID (\d+) as a tracked process "+([^"]+)') { "[$($Matches[1])] + $($Matches[2]) " + (Split-Path $Matches[3] -Leaf) } } | Select-Object -First 6
  "--- overlay lines"
  Get-Content C:\game\steam\logs\console_log.txt | Select-Object -Skip $cl0 | Where-Object { $_ -match 'GameOverlay' }
  "$(T) WM_CLOSE"; $null = $g.CloseMainWindow(); $null = $g.WaitForExit(20000)
  node "$lt\lt.mjs" watch $AppId 40
  "launchers left: " + @(Get-Process EpicGamesLauncher -ErrorAction SilentlyContinue).Count
  Get-Content C:\game\steam\logs\gameprocess_log.txt | Select-Object -Skip $gp0 | Where-Object { $_ -match 'Remove' }
} finally {
  "$(T) " + (J "(()=>{if(window.__ltOrigRunGame){SteamClient.Apps.RunGame=window.__ltOrigRunGame;delete window.__ltOrigRunGame;delete window.__ltGo;delete window.__ltPlay;return 'wrap removed'}return 'no wrap'})()")
}
