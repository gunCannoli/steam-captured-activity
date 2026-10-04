# E6: run an LT shortcut for Minesweeper, then post a test achievement toast for it and see where Steam shows it:
# a desktop toast popup (CDP target notificationtoasts_*_desktop) or the in-game overlay (no desktop popup; overlay line).
param([string]$AppId, [string]$Tag)
$lt = $PSScriptRoot
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
function T { (Get-Date).ToString("HH:mm:ss.fff") }
function Shot($name) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $w = 560; $h = 360
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Right - $w, $b.Bottom - $h, 0, 0, $bmp.Size)
  $bmp.Save((Join-Path $lt "$name.png")); $g.Dispose(); $bmp.Dispose()
}
function DesktopToasts { @((Invoke-RestMethod http://127.0.0.1:8080/json) | Where-Object { $_.title -match '^notificationtoasts_.*desktop' }).Count }
$cl0 = (Get-Content C:\game\steam\logs\console_log.txt).Count
node "$lt\lt.mjs" run $AppId
$g = $null
for ($i = 0; $i -lt 60 -and -not $g; $i++) { Start-Sleep 1; $g = Get-Process Minesweeper -ErrorAction SilentlyContinue | Select-Object -First 1 }
"$(T) game up pid=$($g.Id)"
Start-Sleep 10
$carrier = Get-CimInstance Win32_Process -Filter "Name='ltprobe.exe'" | Select-Object -First 1
"$(T) wrapper/carrier pid=$($carrier.ProcessId)"
Get-Content C:\game\steam\logs\console_log.txt | Select-Object -Skip $cl0 | Where-Object { $_ -match 'GameOverlay' }
$fg = Add-Type -PassThru -Name Fg -Namespace LT -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);'
$fp = 0; $null = $fg::GetWindowThreadProcessId($fg::GetForegroundWindow(), [ref]$fp)
"$(T) foreground window process: $fp ($((Get-Process -Id $fp -ErrorAction SilentlyContinue).Name))"
$before = DesktopToasts
node "$lt\lt.mjs" eval "(()=>{ NotificationStore.TestAchievement($AppId); return 'posted'; })()"
"$(T) toast posted; desktop toast windows before=$before"
Start-Sleep -Milliseconds 1500
Shot "e6-$Tag"
"$(T) desktop toast windows after 1.5 s=$(DesktopToasts)"
Start-Sleep 4
"--- console log overlay lines since start"
Get-Content C:\game\steam\logs\console_log.txt | Select-Object -Skip $cl0 | Where-Object { $_ -match 'GameOverlay|otification' } | Select-Object -First 10
Stop-Process -Id $g.Id -Force
node "$lt\lt.mjs" watch $AppId 12
