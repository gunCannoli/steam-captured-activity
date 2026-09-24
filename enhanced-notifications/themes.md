# Theme Schema (`themes.md`)

A theme restyles Steam's own toasts. Every key is optional; anything unset
stays Steam's own. Example: [themes/steam_midnight.json](themes/steam_midnight.json).

```json
{
  "default":    { ...style },
  "categories": { "friends": { ...style }, "messages": {}, "downloads": {}, "recording": {}, "achievement": {}, "system": {} },
  "types":      { "DownloadComplete": { ...style }, "FriendOnline": { ...style } }
}
```

Resolution: `default` → the type's category → the type. Objects merge key by
key; arrays and tuples are replaced whole. Type names are Steam's
`EClientNotificationType` names (`FriendOnline`, `FriendMessage`,
`DownloadComplete`, `GameRecordingInstantClip`, `CloudSyncFailure`,
`Achievement`, `LowBattery`, …). Unlisted types belong to `system`.

## Style keys

| Key | Format | Notes |
| --- | --- | --- |
| `popup.background` | `["#hex", ...]` | One colour is solid, two or more a gradient |
| `popup.gradient_angle` | degrees | Default `135` |
| `popup.border` | `[width_px, "#hex", radius_px]` | |
| `popup.glow` | `["#hex", spread_px, pulse_ms]` | Inner glow; `pulse_ms` `0` = steady |
| `popup.watermark` | `true` / `false` | Steam logo behind desktop toasts |
| `font_family` | `"Name, Fallback"` | Plain font names only |
| `text.title` / `text.body` / `text.subtext` | `["#hex", size_pct, "bold"\|"regular"\|"italic"]` | Size is relative to Steam's default |
| `logo.visible` | `true` / `false` | App logo |
| `logo.radius` | px | App logo corners |
| `header_icon` | `true` / `false` | Small icon before the title |
| `sound` | `["path", volume_pct]` or `false` | `false` mutes the type; paths relative to the theme folder; `.mp3`, `.wav`, `.ogg` |
| `display_time_ms` | ms | How long the toast stays |

Colours accept `#rgb`, `#rrggbb`, `#rrggbbaa`. Invalid values are ignored
(logged as warnings) and that part stays stock.
