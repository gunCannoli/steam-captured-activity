# Helper of unlock_watcher.mjs: prints one JSON line per change in the top-level windows, the process list and the TCP
# connections. Read-only. Windows and processes are polled every 250 ms, connections every 1 s. The first pass is the
# baseline (one "baseline" line, not appearances).
# For every NEW visible window it also reads the text inside it through UI Automation (a toast's title and body are text
# elements), which is deterministic where a sound or a screenshot is not.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
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
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int k);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
'@
$ErrorActionPreference = 'SilentlyContinue'
# Each event carries `at`: the time the pass that found it STARTED (a slow pass, e.g. many windows, must not make events look late).
$script:passAt = [DateTime]::UtcNow
function Emit($o) { $o.at = $script:passAt.ToString('o'); [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 5)); [Console]::Out.Flush() }
$noiseClass = '^(tooltips_class32|Microsoft\.UI\.Content\.PopupWindowSiteBridge|IME|MSCTFIME UI|CicMarshalWnd|ComboLBox|WorkerW|gdkWindowTemp|Auto-Suggest Dropdown)'
function Flags($ex) {
  $f = @(); if ($ex -band 0x8) { $f += 'TOPMOST' }; if ($ex -band 0x80) { $f += 'TOOLWINDOW' }; if ($ex -band 0x20) { $f += 'TRANSPARENT' }
  if ($ex -band 0x80000) { $f += 'LAYERED' }; if ($ex -band 0x8000000) { $f += 'NOACTIVATE' }; if ($ex -band 0x40000) { $f += 'APPWINDOW' }; $f -join '|'
}
function Snapshot {
  $map = @{}
  $procs = @{}; Get-Process | ForEach-Object { $procs[[uint32]$_.Id] = $_ }
  $fg = [W]::GetForegroundWindow().ToInt64()
  $cb = [W+EnumProc]{ param($h, $l)
    $t = New-Object Text.StringBuilder 256; $c = New-Object Text.StringBuilder 256
    [void][W]::GetWindowText($h, $t, 256); [void][W]::GetClassName($h, $c, 256)
    $procId = [uint32]0; [void][W]::GetWindowThreadProcessId($h, [ref]$procId)
    $r = New-Object W+RECT; [void][W]::GetWindowRect($h, [ref]$r)
    $ex = [W]::GetWindowLong($h, -20)
    $cloaked = 0; [void][W]::DwmGetWindowAttribute($h, 14, [ref]$cloaked, 4)
    $owner = [W]::GetWindow($h, 4).ToInt64()
    $p = $procs[$procId]
    $map["$($h.ToInt64())"] = @{ title = $t.ToString(); cls = $c.ToString(); pid = $procId; proc = $p.ProcessName; path = $p.Path; visible = [W]::IsWindowVisible($h);
      cloaked = [bool]$cloaked; owner = $owner; foreground = ($h.ToInt64() -eq $fg); rect = "$($r.L),$($r.T) $($r.R - $r.L)x$($r.B - $r.T)"; exstyle = ('0x{0:X}' -f $ex); flags = (Flags $ex) }
    $true }
  [void][W]::EnumWindows($cb, [IntPtr]::Zero)
  return $map
}
# Text inside a window: names of its UI Automation descendants (depth-limited, 60 elements).
function WindowText($hwnd) {
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][int64]$hwnd)
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $out = @(); $n = 0
    foreach ($e in $all) { if ($n++ -ge 60) { break }; $name = $e.Current.Name; if ($name) { $out += ("{0}: {1}" -f $e.Current.ControlType.ProgrammaticName.Replace('ControlType.', ''), $name) } }
    return $out
  } catch { return @("(uia failed: $($_.Exception.Message))") }
}
# Windows' DNS client cache: name -> addresses (and CNAME chains). A new connection's address is looked up here, so the log says
# "api.epicgames.dev" and not just an IP; a new cache entry is itself a trace (something resolved a name).
function DnsMap {
  $ip = @{}; $cname = @{}
  Get-DnsClientCache | ForEach-Object { if ($_.Type -eq 5) { $cname[$_.Data] = $_.Name } elseif ($_.Data) { $ip[$_.Data] = $_.Name } }
  foreach ($k in @($ip.Keys)) { $n = $ip[$k]; $guard = 0; $chain = @($n); while ($cname.ContainsKey($n) -and $guard++ -lt 6) { $n = $cname[$n]; $chain += $n }; $ip[$k] = ($chain[($chain.Count - 1)..0] -join ' <- ') }
  return $ip
}
function Conns {
  $m = @{}; $names = @{}; Get-Process | ForEach-Object { $names[[int]$_.Id] = $_.ProcessName }
  Get-NetTCPConnection -State Established | Where-Object { $_.RemoteAddress -notmatch '^(127\.|::1|0\.0\.0\.0)' } | ForEach-Object {
    $m["$($_.OwningProcess)|$($_.RemoteAddress):$($_.RemotePort)"] = @{ pid = $_.OwningProcess; proc = $names[[int]$_.OwningProcess]; remote = "$($_.RemoteAddress):$($_.RemotePort)"; local = $_.LocalPort } }
  return $m
}
$prevW = Snapshot
$prevP = @{}; Get-CimInstance Win32_Process | ForEach-Object { $prevP["$($_.ProcessId)"] = $_ }
$prevC = Conns
$prevD = DnsMap
Emit @{ kind = 'baseline'; windows = $prevW.Count; processes = $prevP.Count; connections = $prevC.Count }
$tick = 0
while ($true) {
  Start-Sleep -Milliseconds 250
  $tick++
  $script:passAt = [DateTime]::UtcNow
  # F8 anywhere (even inside a game, even over RDP, where the console may not get Enter): a user mark.
  # (bit 0 = "pressed since the last call", so a tap shorter than the 250 ms poll is still seen)
  if (([W]::GetAsyncKeyState(0x77) -band 0x1) -ne 0) { Emit @{ kind = 'hotkey'; key = 'F8' } }
  $now = Snapshot
  foreach ($k in $now.Keys) {
    $n = $now[$k]
    if (-not $prevW.ContainsKey($k)) {
      $ev = @{ kind = 'window+'; hwnd = $k; w = $n }
      if ($n.visible -and $n.rect -notmatch ' 0x0$' -and $n.cls -notmatch $noiseClass) { $ev.text = WindowText $k }
      Emit $ev
    } else {
      $o = $prevW[$k]; $d = @{}
      foreach ($f in 'title', 'visible', 'rect', 'exstyle', 'cloaked', 'foreground') { if ($o[$f] -ne $n[$f]) { $d[$f] = "$($o[$f]) -> $($n[$f])" } }
      if ($d.Count) {
        $ev = @{ kind = 'window~'; hwnd = $k; cls = $n.cls; proc = $n.proc; changes = $d }
        if ($d.ContainsKey('visible') -and $n.visible -and $n.cls -notmatch $noiseClass) { $ev.text = WindowText $k }
        Emit $ev
      }
    }
  }
  foreach ($k in $prevW.Keys) { if (-not $now.ContainsKey($k)) { Emit @{ kind = 'window-'; hwnd = $k; w = $prevW[$k] } } }
  $prevW = $now
  $curP = @{}; Get-CimInstance Win32_Process | ForEach-Object { $curP["$($_.ProcessId)"] = $_ }
  foreach ($k in $curP.Keys) { if (-not $prevP.ContainsKey($k)) { $p = $curP[$k]; Emit @{ kind = 'process+'; pid = $p.ProcessId; ppid = $p.ParentProcessId; name = $p.Name; path = $p.ExecutablePath; cmd = "$($p.CommandLine)".Substring(0, [Math]::Min(400, "$($p.CommandLine)".Length)) } } }
  foreach ($k in $prevP.Keys) { if (-not $curP.ContainsKey($k)) { Emit @{ kind = 'process-'; pid = $k; name = $prevP[$k].Name } } }
  $prevP = $curP
  if ($tick % 4 -eq 0) {
    $curC = Conns
    $curD = DnsMap
    foreach ($k in $curD.Keys) { if (-not $prevD.ContainsKey($k)) { Emit @{ kind = 'dns+'; address = $k; name = $curD[$k] } } }
    foreach ($k in $curC.Keys) { if (-not $prevC.ContainsKey($k)) { $c = $curC[$k]; $addr = $c.remote -replace ':\d+$', '' -replace '^\[|\]$', ''; $c.host = $curD[$addr]; if (-not $c.host) { $c.host = $prevD[$addr] }; Emit @{ kind = 'conn+'; c = $c } } }
    foreach ($k in $prevC.Keys) { if (-not $curC.ContainsKey($k)) { Emit @{ kind = 'conn-'; c = $prevC[$k] } } }
    $prevC = $curC; $prevD = $curD
  }
}
