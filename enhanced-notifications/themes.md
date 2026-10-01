# Theme Schema (`themes.md`)

A theme restyles Steam's own toasts. Every key is optional; anything unset
stays Steam's own. Example: [themes/steam_midnight.json](themes/steam_midnight.json).

**File format:** `.jsonc` or `.json`. Both accept JSONC: `//` and `/* */`
comments and trailing commas. If a folder has both `name.jsonc` and
`name.json`, the `.jsonc` is used (same rules as Enhanced Achievements).

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
| `sound` | `["path", volume_pct]` or `false` | `false` mutes the type; see File paths; `.mp3`, `.wav`, `.ogg` |
| `display_time_ms` | ms | How long the toast stays |

Colours accept `#rgb`, `#rrggbb`, `#rrggbbaa`. Invalid values are ignored
(logged as warnings) and that part stays stock.

## File paths

- A relative path resolves against the theme file's own folder, so a theme and
  its sounds can be shared as one directory.
- An absolute path (`C:/…`) is allowed for personal themes, but makes the theme
  non-portable.
- The backend loads each sound once when the theme is (re)loaded, never per toast.
  A missing, oversized (> 8 MB) or disallowed file keeps Steam's sound for that type.
