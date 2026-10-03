# Helper of unlock_watcher.mjs: prints one JSON line per change in the top-level windows and the process list.
# Read-only. Polls every 250 ms. The first pass is the baseline (reported as one "baseline" line, not as appearances).
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern int GetWindowLong(IntPtr h, int i);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
'@
$ErrorActionPreference = 'SilentlyContinue'
function Emit($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }
function Snapshot {
  $map = @{}
  $procs = @{}; Get-Process | ForEach-Object { $procs[[uint32]$_.Id] = $_.ProcessName }
  $cb = [W+EnumProc]{ param($h, $l)
    $t = New-Object Text.StringBuilder 256; $c = New-Object Text.StringBuilder 256
    [void][W]::GetWindowText($h, $t, 256); [void][W]::GetClassName($h, $c, 256)
    $procId = [uint32]0; [void][W]::GetWindowThreadProcessId($h, [ref]$procId)
    $r = New-Object W+RECT; [void][W]::GetWindowRect($h, [ref]$r)
    $ex = [W]::GetWindowLong($h, -20)
    $map["$($h.ToInt64())"] = @{ title = $t.ToString(); cls = $c.ToString(); pid = $procId; proc = $procs[$procId]; visible = [W]::IsWindowVisible($h);
      rect = "$($r.L),$($r.T) $($r.R - $r.L)x$($r.B - $r.T)"; exstyle = ('0x{0:X}' -f $ex) }
    $true }
  [void][W]::EnumWindows($cb, [IntPtr]::Zero)
  return $map
}
$prevW = Snapshot
$prevP = @{}; Get-CimInstance Win32_Process | ForEach-Object { $prevP["$($_.ProcessId)"] = $_ }
Emit @{ kind = 'baseline'; windows = $prevW.Count; processes = $prevP.Count }
while ($true) {
  Start-Sleep -Milliseconds 250
  $now = Snapshot
  foreach ($k in $now.Keys) {
    $n = $now[$k]
    if (-not $prevW.ContainsKey($k)) { Emit @{ kind = 'window+'; hwnd = $k; w = $n } }
    else {
      $o = $prevW[$k]; $d = @{}
      foreach ($f in 'title', 'visible', 'rect', 'exstyle') { if ($o[$f] -ne $n[$f]) { $d[$f] = "$($o[$f]) -> $($n[$f])" } }
      if ($d.Count) { Emit @{ kind = 'window~'; hwnd = $k; cls = $n.cls; proc = $n.proc; changes = $d } }
    }
  }
  foreach ($k in $prevW.Keys) { if (-not $now.ContainsKey($k)) { Emit @{ kind = 'window-'; hwnd = $k; w = $prevW[$k] } } }
  $prevW = $now
  $curP = @{}; Get-CimInstance Win32_Process | ForEach-Object { $curP["$($_.ProcessId)"] = $_ }
  foreach ($k in $curP.Keys) { if (-not $prevP.ContainsKey($k)) { $p = $curP[$k]; Emit @{ kind = 'process+'; pid = $p.ProcessId; ppid = $p.ParentProcessId; name = $p.Name; cmd = "$($p.CommandLine)".Substring(0, [Math]::Min(300, "$($p.CommandLine)".Length)) } } }
  foreach ($k in $prevP.Keys) { if (-not $curP.ContainsKey($k)) { Emit @{ kind = 'process-'; pid = $k; name = $prevP[$k].Name } } }
  $prevP = $curP
}
