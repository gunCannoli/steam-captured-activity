# E10 (ADR-0058): a converted Xbox UWP shortcut (U0) through Steam's own Play button, then the repair after a simulated app
# update (the shortcut pointed at an older version's folder; the plugin's 60 s check must point it back, keeping the appid,
# with no duplicate added). Needs the Steam lock.
param([string]$AppId = "2663546656", [string]$Image = "Minesweeper", [int]$Play = 15)
$lt = $PSScriptRoot
function T { (Get-Date).ToString("HH:mm:ss.fff") }
function J([string]$e) { node "$lt\lt.mjs" eval $e }
function Vdf([string]$name) {
  $py = @"
import re
d = open(r'C:\game\steam\userdata\83513586\config\shortcuts.vdf','rb').read()
n = d.count(b'\x01AppName\x00$name\x00')
i = d.find(b'\x01AppName\x00$name')
m = re.search(b'\x01Exe\x00([^\x00]*)\x00', d[i:i+900], re.I)
print(n, int.from_bytes(d[i-4:i], 'little'), m.group(1).decode() if m else None)
"@
  $py | python -
}
$js0 = (Get-Content C:\game\steam\logs\webhelper_js.txt).Count
"=== 1. Play"
J "(()=>{const w=SteamUIStore.WindowStore.SteamUIWindows.find(w=>w.Navigator?.AppProperties);w.Navigator.App($AppId);return 'page opened'})()"
Start-Sleep 5
$c = Get-Date
J "(()=>{const w=SteamUIStore.WindowStore.SteamUIWindows.find(w=>w.Navigator?.AppProperties);const b=w.m_BrowserWindow.document.querySelector('.PlayButton');if(!b)return 'no Play button';b.click();return 'clicked Play'})()"
$g = $null
for ($i = 0; $i -lt 60 -and -not $g; $i++) { Start-Sleep 1; $g = Get-Process $Image -ErrorAction SilentlyContinue | Select-Object -First 1 }
if ($g) {
  $pp = (Get-CimInstance Win32_Process -Filter "ProcessId=$($g.Id)").ParentProcessId
  "$(T) game up {0:N1} s after Play, pid=$($g.Id) parent=$pp ($((Get-Process -Id $pp -ErrorAction SilentlyContinue).Name))" -f ((Get-Date) - $c).TotalSeconds
  Start-Sleep 3; node "$lt\lt.mjs" state $AppId
  Start-Sleep $Play; node "$lt\lt.mjs" state $AppId
  "$(T) ending the game"; Stop-Process -Id $g.Id -Force
  node "$lt\lt.mjs" watch $AppId 12
} else { "$(T) the game did not start" }
"=== 2. repair after a simulated update"
"before: " + (Vdf "Microsoft Minesweeper")
$old = "C:\Program Files\WindowsApps\Microsoft.MicrosoftMinesweeper_4.7.8000.0_x64__8wekyb3d8bbwe"
$exeJson = ConvertTo-Json ('"' + $old + '\Minesweeper.exe"'); $dirJson = ConvertTo-Json ('"' + $old + '\"')
J "(()=>{SteamClient.Apps.SetShortcutExe($AppId, $exeJson);SteamClient.Apps.SetShortcutStartDir($AppId, $dirJson);return 'pointed at the old version'})()"
Start-Sleep 2
"$(T) outdated: " + (Vdf "Microsoft Minesweeper")
$fixed = $false
for ($i = 0; $i -lt 75 -and -not $fixed; $i++) { Start-Sleep 1; $fixed = (Vdf "Microsoft Minesweeper") -match '4\.7\.9021\.0' }
"$(T) after waiting: " + (Vdf "Microsoft Minesweeper") + " (repaired: $fixed)"
"--- plugin log"
Get-Content C:\game\steam\logs\webhelper_js.txt | Select-Object -Skip $js0 | Where-Object { $_ -match 'Xbox shortcut|Auto-add' } | ForEach-Object { $_ -replace '^(.{0,24}).*?(Xbox shortcut.*|Auto-add.*)$', '$1 $2' }
