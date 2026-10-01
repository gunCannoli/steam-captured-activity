# Theme Schema (`themes.md`)

A theme restyles Steam's own toasts. **One style for every notification**, so
toasts stay consistent. Every key is optional; anything unset stays Steam's own.
Example: [themes/steam_midnight.json](themes/steam_midnight.json).

**File format:** `.jsonc` or `.json`. Both accept JSONC: `//` and `/* */`
comments and trailing commas. If a folder has both `name.jsonc` and
`name.json`, the `.jsonc` is used (same rules as Enhanced Achievements).

```jsonc
{
  "settings": { "position": "top_right", "animation": "ps5", "display_time_ms": 4000 },
  "popup":    { "background": ["#0e141b", "#1b2838"], "border": [1, "#66c0f455", 6], "margin": 10, "padding": [8, 12] },
  "text":     { "title": ["#66c0f4", 100, "bold"] },
  "logo":     { "radius": 6 },
  "sound":    false
}
```

The older `default`, `categories` and `types` blocks are gone; a theme that
still has them loads with a warning and they are ignored.

## Settings

In a top-level `settings` object. Same names and values as Enhanced Achievements' `settings`.

| Key | Format | Notes |
| --- | --- | --- |
| `position` | `"top_right"`, `"top_left"`, `"bottom_right"`, `"bottom_left"`, `"top_center"`, `"bottom_center"` | Screen corner. Unset: Steam's own corner. On desktop Steam's stacking is kept: the newest toast sits at the corner and older ones move inward |
| `animation` | `"slide"`, `"fade"`, `"up"`, `"down"`, `"ps5"`, `"none"`, or `{ "in": ..., "out": ... }` | Entrance and exit. One name sets both; in the object form an unset side is `slide` (in) or `fade` (out). Unset: Steam's own. `slide` and `ps5` move from the side of the corner (`ps5`: a short slide with a fade, vertical for the centred positions) |
| `display_time_ms` | ms, `1000`–`60000` | How long every toast stays. Unset: Steam's own per type |

Position and animation apply on desktop, in the in-game overlay and in Big
Picture. With an `animation`, the toast does not travel with Steam's slide: it
appears at its place, and the exit ends when Steam closes the toast.

Achievement toasts drawn by Enhanced Achievements keep that plugin's style,
sound, animation and (on desktop) position. In Big Picture there is one toast
place for every toast, so a `position` here moves its achievement toasts too,
unless Enhanced Achievements' "Force achievement position in Big Picture" is on.

## Style keys

At the top level of the theme.

| Key | Format | Notes |
| --- | --- | --- |
| `popup.background` | `["#hex", ...]` | One colour is solid, two or more a gradient |
| `popup.gradient_angle` | degrees | Default `135` |
| `popup.border` | `[width_px, "#hex", radius_px]` | |
| `popup.glow` | `["#hex", spread_px, pulse_ms]` | Inner glow; `pulse_ms` `0` = steady |
| `popup.watermark` | `true` / `false` | Steam logo behind desktop toasts |
| `popup.margin` | CSS shorthand: `px`, `[vertical, horizontal]`, `[top, horizontal, bottom]` or `[top, right, bottom, left]` | Distance from the screen corner; only the sides the toast is anchored to count (`top_right` uses top and right; centred positions ignore left and right). Works with Steam's own corner too |
| `popup.padding` | CSS shorthand, as `margin` | Space inside the toast around the logo and text. Steam's is `10` on desktop |
| `popup.gap` | `px` or `[logo_to_text, between_rows]` | Steam's is `[12, 0]` on desktop |
| `font_family` | `"Name, Fallback"` | Plain font names only |
| `text.title` / `text.body` / `text.subtext` | `["#hex", size_pct, "bold"\|"regular"\|"italic"]` | Size is relative to Steam's default |
| `logo.visible` | `true` / `false` | The game's logo on the left of the toast |
| `logo.radius` | px | Rounds the corners of that logo (Steam's is square) |
| `header_icon` | `true` / `false` | Small icon before the title |
| `sound` | `["path", volume_pct]` or `false` | Every notification's sound; `false` mutes them; see File paths; `.mp3`, `.wav`, `.ogg` |

`margin` and `padding` take CSS's clockwise order, like Enhanced Achievements:
`[10, 5, 4, 7]` is 10 top, 5 right, 4 bottom, 7 left.

Colours accept `#rgb`, `#rrggbb`, `#rrggbbaa`. Invalid values are ignored
(logged as warnings) and that part stays stock.

## File paths

- A relative path resolves against the theme file's own folder, so a theme and
  its sound can be shared as one directory.
- An absolute path (`C:/…`) is allowed for personal themes, but makes the theme
  non-portable.
- The backend loads the sound once when the theme is (re)loaded, never per toast.
  A missing, oversized (> 8 MB) or disallowed file keeps Steam's sound.
