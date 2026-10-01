# Theme Schema (`themes.md`)

A theme restyles Steam's own toasts. Every key is optional; anything unset
stays Steam's own. Example: [themes/steam_midnight.json](themes/steam_midnight.json).

**File format:** `.jsonc` or `.json`. Both accept JSONC: `//` and `/* */`
comments and trailing commas. If a folder has both `name.jsonc` and
`name.json`, the `.jsonc` is used (same rules as Enhanced Achievements).

```json
{
  "settings":   { "position": "top_right", "animation": "ps5" },
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

## Settings

Theme-wide, in a top-level `settings` object. Same names and values as Enhanced Achievements'
`settings`. Both apply to desktop and in-game overlay toasts; in Big Picture, Steam's own place and
motion stay.

| Key | Format | Notes |
| --- | --- | --- |
| `position` | `"top_right"`, `"top_left"`, `"bottom_right"`, `"bottom_left"`, `"top_center"`, `"bottom_center"` | Screen corner. Unset: Steam's own corner (the one picked in Steam's settings). Steam's stacking is kept: the newest toast sits at the corner and older ones move inward |
| `animation` | `"slide"`, `"fade"`, `"up"`, `"down"`, `"ps5"`, `"none"`, or `{ "in": ..., "out": ... }` | Entrance and exit. One name sets both; in the object form an unset side is `slide` (in) or `fade` (out). Unset: Steam's own slide. `slide` and `ps5` move from the side of the corner (`ps5`: a short slide with a fade, vertical for the centred positions) |

With an `animation`, the toast does not travel with Steam's slide: it appears at its place, and the exit ends
when Steam closes the toast (Steam's slide in, then the type's display time, then Steam's slide out).
Achievement toasts drawn by Enhanced Achievements keep that plugin's own position and animation.

## Style keys

| Key | Format | Notes |
| --- | --- | --- |
| `popup.background` | `["#hex", ...]` | One colour is solid, two or more a gradient |
| `popup.gradient_angle` | degrees | Default `135` |
| `popup.border` | `[width_px, "#hex", radius_px]` | |
| `popup.glow` | `["#hex", spread_px, pulse_ms]` | Inner glow; `pulse_ms` `0` = steady |
| `popup.watermark` | `true` / `false` | Steam logo behind desktop toasts |
| `popup.margin` | `px`, `[vertical, horizontal]` or `[top, bottom, left, right]` | Distance from the screen corner; only the sides the toast is anchored to count (`top_right` uses top and right; centred positions ignore left and right). Works with Steam's own corner too. Desktop and overlay only |
| `popup.padding` | `px`, `[vertical, horizontal]` or `[top, bottom, left, right]` | Space inside the toast around the logo and text. Steam's is `10` |
| `popup.gap` | `px` or `[logo_to_text, between_rows]` | Steam's is `[12, 0]` |
| `font_family` | `"Name, Fallback"` | Plain font names only |
| `text.title` / `text.body` / `text.subtext` | `["#hex", size_pct, "bold"\|"regular"\|"italic"]` | Size is relative to Steam's default |
| `logo.visible` | `true` / `false` | App logo |
| `logo.radius` | px | App logo corners |
| `header_icon` | `true` / `false` | Small icon before the title |
| `sound` | `["path", volume_pct]` or `false` | `false` mutes the type; see File paths; `.mp3`, `.wav`, `.ogg` |
| `display_time_ms` | ms | How long the toast stays |

`margin` and `padding` take Enhanced Achievements' order: four values are top, bottom, left,
right (not CSS's clockwise order), so `[10, 5, 4, 7]` is 10 top, 5 bottom, 4 left, 7 right.

Colours accept `#rgb`, `#rrggbb`, `#rrggbbaa`. Invalid values are ignored
(logged as warnings) and that part stays stock.

## File paths

- A relative path resolves against the theme file's own folder, so a theme and
  its sounds can be shared as one directory.
- An absolute path (`C:/…`) is allowed for personal themes, but makes the theme
  non-portable.
- The backend loads each sound once when the theme is (re)loaded, never per toast.
  A missing, oversized (> 8 MB) or disallowed file keeps Steam's sound for that type.
