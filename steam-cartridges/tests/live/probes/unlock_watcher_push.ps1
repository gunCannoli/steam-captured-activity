# Helper of unlock_watcher.mjs: an event-driven watcher on Windows' push-notification log. Every push Windows receives is
# recorded there WITH its payload as hex; this prints one JSON line per push with the payload decoded, the moment the log
# writes it (no polling, so no 1 s granularity and no PowerShell start-up per check). Xbox achievements arrive here as
# raw pushes whose body is JSON with "service":"achievements". Read-only.
$ErrorActionPreference = 'Stop'
$log = 'Microsoft-Windows-PushNotification-Platform/Operational'
$q = [System.Diagnostics.Eventing.Reader.EventLogQuery]::new($log, [System.Diagnostics.Eventing.Reader.PathType]::LogName)
$w = [System.Diagnostics.Eventing.Reader.EventLogWatcher]::new($q)
[void](Register-ObjectEvent -InputObject $w -EventName EventRecordWritten -Action {
  $r = $Event.SourceEventArgs.EventRecord
  if (-not $r) { return }
  try {
    $received = [DateTime]::UtcNow.ToString('o')
    $m = "$($r.FormatDescription())"
    $h = [regex]::Match($m, 'payload: 0x([0-9A-Fa-f]+)')
    if ($h.Success -and $h.Groups[1].Value.Length -lt 20000) {
      $hex = $h.Groups[1].Value
      $b = for ($i = 0; $i -lt $hex.Length; $i += 2) { [Convert]::ToByte($hex.Substring($i, 2), 16) }
      $o = @{ kind = 'push'; id = $r.Id; written = $r.TimeCreated.ToUniversalTime().ToString('o'); received = $received; payload = [Text.Encoding]::UTF8.GetString($b) }
      [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush()
    }
  } catch { } finally { $r.Dispose() }
})
$w.Enabled = $true
[Console]::Out.WriteLine('{"kind":"ready"}'); [Console]::Out.Flush()
while ($true) { Start-Sleep -Seconds 1 }
