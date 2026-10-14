# E4b: a plain CreateProcess of a UWP exe. Who becomes the game's parent, and how long does SystemUWPLauncher live?
param([string]$Exe = "C:\Program Files\WindowsApps\Microsoft.MicrosoftMinesweeper_4.7.9021.0_x64__8wekyb3d8bbwe\Minesweeper.exe", [string]$Image = "Minesweeper")
function T { (Get-Date).ToString("HH:mm:ss.fff") }
$l = Start-Process -FilePath $Exe -PassThru
"$(T) started pid=$($l.Id) name=$($l.ProcessName)"
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep 1
  $g = Get-CimInstance Win32_Process -Filter "Name='$Image.exe'" | Select-Object -First 1
  $s = Get-CimInstance Win32_Process -Filter "Name='SystemUWPLauncher.exe'"
  "$(T) game=" + ($(if ($g) { "$($g.ProcessId) ppid=$($g.ParentProcessId)" } else { "none" })) + " SystemUWPLauncher=" + (($s | ForEach-Object { "$($_.ProcessId) ppid=$($_.ParentProcessId)" }) -join ";")
}
$g = Get-Process -Name $Image -ErrorAction SilentlyContinue
if ($g) { Stop-Process -Id $g.Id -Force; "$(T) game ended" }
for ($i = 0; $i -lt 6; $i++) { Start-Sleep 1; "$(T) SystemUWPLauncher alive: " + [bool](Get-Process -Name SystemUWPLauncher -ErrorAction SilentlyContinue) }
"cmdline of the launcher (no secrets here): " + (Get-CimInstance Win32_Process -Filter "Name='SystemUWPLauncher.exe'" | Select-Object -First 1).CommandLine
