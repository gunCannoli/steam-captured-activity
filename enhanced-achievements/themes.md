# Theme Schema (`themes.md`)

Reference for every section, key, and tuple format in an `enhanced-achievements`
theme file. The canonical example is [steam_ps_exemple.json](steam_ps_exemple.json);
a minimal one is [theme_exemple.json](theme_exemple.json).

A **theme** only describes how an unlock looks and sounds. What the plugin does
(which theme is active, feature toggles, capture defaults) is a plugin setting,
changed in the plugin's settings panel — see [Plugin settings](#plugin-settings).

---

## Root: `settings`

Display behaviour for this theme's banners.

- **`layout`**: How the banner's parts are arranged.
    - `"default_steam"`: Achievement icon on the left, title and description stacked on the right.
    - `"default_system_right"`: Achievement icon on the left, text in the middle, system icon pinned to the right edge.
    - `"compact_pill"`: Slim horizontal bar with icon and title.
    - `"custom"`: Reserved for template slots (not in the first release).
- **`position`**: Screen anchor: `"topright"`, `"topleft"`, `"bottomright"`, `"bottomleft"`, `"topcenter"`, `"bottomcenter"`.
- **`display_time_ms`**: How long the banner stays on screen before its exit animation (e.g. `4000` = 4 s).
- **`animation`**: Entrance and exit transition: `"slide"`, `"fade"`, `"up"`, `"down"`.

Any key that is missing or invalid falls back to the default above (first
listed value; `display_time_ms` falls back to Steam's own toast duration).

---

## Root: `themes`

One visual and audio profile per rarity tier.

- **`normal`** (Bronze): the base tier. Every key defined here is the fallback for the other tiers.
- **`magic`** (Silver): used when the achievement's global unlock rate is ≤ `magic.threshold`.
- **`rare`** (Gold): used when the global unlock rate is ≤ `rare.threshold`.
- **`exceptional`** (Platinum): used when the unlock brings the game to 100% completion.

Tier selection, first match wins: `exceptional` → `rare` → `magic` → `normal`.
When Steam gives no global unlock rate (common for non-Steam games), the tier is
`normal` unless the unlock completes the game.

> **Inheritance:** `magic`, `rare` and `exceptional` only list what differs from
> `normal`. Objects merge key by key; tuples and arrays are replaced whole.

---

## Tier keys

### `threshold` (number)

Global unlock percentage cutoff for `magic` and `rare`.

- `"threshold": 10.0` matches when 10% or fewer of players have the achievement.
- Recommended: `magic` = `25.0`, `rare` = `10.0`.

### `box`

Geometry, colours, border and glow of the banner.

- **`scale`**: `[width_pct, height_pct]` — size relative to the default (`[100, 100]` = standard, `[150, 150]` = 1.5×).
- **`background_color`**: `["#hex", ...]` — one colour is solid; two or more make a gradient.
- **`gradient_angle`**: degrees (`90` = left→right, `180` = top→bottom, `135` = diagonal).
- **`border`**: `[width_px, "#hex", radius_px]` — `width_px` `0` disables the stroke; `radius_px` `0` is square, `25` is a capsule.
- **`glow`**: `["#hex", spread_px, pulse_ms]` — `spread_px` `0` turns the glow off; `pulse_ms` `0` is steady, `1500` breathes every 1.5 s.

Colours accept `#rgb`, `#rrggbb` and `#rrggbbaa`.

### `text`

- **`title`** and **`desc`**: `["#hex", size_pct, style]`
    - `size_pct`: relative to the base font size (`100` = base, `110` = 10% larger).
    - `style`: `"bold"`, `"regular"` or `"italic"`.

### `icons`

Every slot takes `[source, ripple_ms]`, or just `source` as shorthand for `[source, 0]`.

- **`source`**
    - `true`: show Steam's own asset (the achievement art, or Steam's logo for `system`).
    - `false`: hide the slot.
    - `"path"`: a custom `.png` or `.svg`.
- **`ripple_ms`**: `0` is static; `> 0` loops an expanding ring behind the icon at that period.

Slots:

- **`achievement`**: the achievement's own artwork.
- **`system`**: platform logo (Steam, PlayStation, …).
- **`rarity`**: tier emblem (bronze, silver, gold, 100% badge).
- **`exceptional`**: extra badge shown only on 100% completion.

### `sound`

`["path", volume_pct]` — `.mp3`, `.wav` or `.ogg`; volume `0`–`100`.
Omit it (in every tier) to keep Steam's own chime. A file that is missing or
fails to load also falls back to Steam's chime — never to silence.

### Capture overrides: `screenshot`, `recording`

Optional. They override the plugin's capture settings for this tier only,
using the same keys:

- **`screenshot`**: `{ "enabled": bool, "delay_ms": number }`
- **`recording`**: `{ "enabled": bool, "duration_s": number, "delay_ms": number }`

Example: keep recording off in the plugin settings and enable it only on `rare` and
`exceptional`, so only notable unlocks produce clips.

---

## File paths

- A relative path resolves against the theme file's own folder, so a theme and
  its `assets/` folder can be shared as one directory.
- An absolute path (`C:/…`) is allowed for personal themes, but makes the theme
  non-portable.
- The frontend cannot read local files directly; the backend loads each asset
  once when the theme is (re)loaded, never per unlock.

---

## Plugin settings

Not part of a theme. Set in the plugin's settings panel (Millennium sidebar) and
stored by Millennium. [settings.json](settings.json) holds the shipped defaults;
you never need to edit it.

```json
{
    "theme": "steam_ps_exemple",
    "banner": { "enabled": true },
    "sound": { "enabled": true },
    "screenshot": { "enabled": true, "delay_ms": 500 },
    "recording": {
        "enabled": true,
        "duration_s": 15,
        "delay_ms": 0,
        "add_timeline_marker": true
    }
}
```

- **`theme`**: file name (without `.json`) of the active theme in `themes/`.
- **`banner.enabled`** / **`sound.enabled`**: turn each part off independently. Off means Steam's stock toast or chime, untouched.
- **`screenshot`** / **`recording`**: capture defaults, overridable per tier (Phase 7).

The panel also has **Preview** buttons (one per tier), **Reload themes** and
**Open themes folder**, so the theme workflow is: edit the JSON → Reload → Preview.

## Sharing themes

A theme is one `.json` file plus the assets it references. Put them in one
folder with relative paths (`assets/gold.png`) and share that folder. To install,
drop it into the themes folder and pick it in the settings panel.
