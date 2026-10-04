# Control for E6 and E3: Jotunnslayer in Steam's tree (launcher shortcut + reaper). Post a test toast and list the toast
# windows Steam creates; try a manual recording. Then close the game; the reaper ends the launcher.
param([string]$AppId)
$lt = $PSScriptRoot
function T { (Get-Date).ToString("HH:mm:ss.fff") }
function ToastTitles { ((Invoke-RestMethod http://127.0.0.1:8080/json) | Where-Object { $_.title -match 'toast' } | ForEach-Object { $_.title }) -join "," }
$root = "C:\Program Files\Epic Games\JotunnslayerHordesofrI2Zp"
$since = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
Start-Process -FilePath "$lt\ltprobe.exe" -ArgumentList @("reap", "--root", "`"$root`"", "--app", "05cc03868360490aa4d7138723f4d99e", "--since", "$since", "--grace", "30", "--timeout", "300")
$cl0 = (Get-Content C:\game\steam\logs\console_log.txt).Count
node "$lt\lt.mjs" run $AppId
$g = $null
for ($i = 0; $i -lt 180 -and -not $g; $i++) { Start-Sleep 1; $g = Get-Process Jotunnslayer -ErrorAction SilentlyContinue }
"$(T) game up pid=$($g.Id)"
Start-Sleep 15
$fg = Add-Type -PassThru -Name Fg2 -Namespace LT -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);'
$fp = 0; $null = $fg::GetWindowThreadProcessId($fg::GetForegroundWindow(), [ref]$fp)
"$(T) foreground: $fp ($((Get-Process -Id $fp -ErrorAction SilentlyContinue).Name))"
"$(T) toast windows before: " + (ToastTitles)
node "$lt\lt.mjs" eval "(()=>{ NotificationStore.TestAchievement($AppId); return 'posted'; })()"
Start-Sleep -Milliseconds 1500
"$(T) toast windows after 1.5 s: " + (ToastTitles)
node "$lt\lt.mjs" state $AppId
node "$lt\lt.mjs" rec $AppId start | ForEach-Object { $_.Substring(0, [Math]::Min(60, $_.Length)) }
Start-Sleep 8
node "$lt\lt.mjs" state $AppId
node "$lt\lt.mjs" rec $AppId stop
Get-Content C:\game\steam\logs\console_log.txt | Select-Object -Skip $cl0 | Where-Object { $_ -match 'GameOverlay' }
"$(T) WM_CLOSE"; $null = $g.CloseMainWindow(); $null = $g.WaitForExit(20000)
node "$lt\lt.mjs" watch $AppId 40
"launchers left: " + @(Get-Process EpicGamesLauncher -ErrorAction SilentlyContinue).Count
