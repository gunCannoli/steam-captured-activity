# Theme Schema (`themes.md`)

A theme restyles Steam's own toasts. **One look for every notification**, so
toasts stay consistent: `settings`, `popup` and `text` apply to every toast.
Every key is optional; anything unset stays Steam's own. An optional
[`achievements`](#achievements) block replaces achievement toasts with a themed
banner per rarity tier, built from that same look; without it, achievement
toasts are styled like every other toast.

**Defaults.** A theme sets only what it changes. A key it leaves out uses the
default, which is Steam's own unless this page names another:

| Left out | Default |
| --- | --- |
| `settings.position`, `settings.animation` | Steam's own corner and slide |
| `settings.display_time_ms` | Steam's own display time, per notification type |
| `sound` | Steam's own sounds (Steam's mute setting is always respected) |
| `popup`, `text`, `game_icon`, ... | Steam's own look |
| `achievements` | Achievement toasts get the notification style, like every toast |

**Steam default**, the first entry of the theme list and the shipped default,
is no theme at all: every notification keeps Steam's look, sound and display
time. There are no on/off switches for the style, sounds or display time: pick
a theme that leaves the key out, or Steam default.

**[themes/theme_example.jsonc](themes/theme_example.jsonc) is the commented version of this
page**: every option, in a working theme you can copy and trim. Also bundled:
[steam_midnight](themes/steam_midnight.json) (no achievement banner),
[ps5](themes/ps5.jsonc) and [steam_tiers](themes/steam_tiers.json)
(colour-coded tiers). Fuller, asset-based examples are in
[examples/](examples/).

**File format:** `.jsonc` or `.json`. Both accept JSONC: `//` and `/* */`
comments and trailing commas. If there are both `name.jsonc` and `name.json`,
the theme list shows both, the `.jsonc` one as `name (jsonc)`.

```jsonc
{
  "settings":  { "position": "top_right", "animation": "ps5", "display_time_ms": 4000, "text_align": "left" },
  "popup":     { "background": ["#1F1F1F", "#0F0F0F"], "border": [0, "#8a2be2", 8], "margin": 10, "padding": 10, "gap": 10 },
  "text":      { "title": ["#ffffff", 120, "regular"], "body": ["#ffffff", 100, "regular"] },
  "game_icon": [true, 8],
  "achievements": {
    "layout": "ps5",
    "padding": [10, 15, 10, 10],   // any popup key: overrides the popup for the banner
    "normal": { "icons": { "rarity": "assets/trophy_bronze.svg" } },
    "rare":   { "threshold": 10, "border": [2, "#e5a93c", 8], "icons": { "rarity": "assets/trophy_gold.svg" } }
  }
}
```

A theme only describes how toasts look and sound. What the plugin does (which
theme is active, the notifications queue, captures on unlock) is a plugin
setting, in the settings panel: see [Plugin settings](#plugin-settings).

### Older formats

These keys are gone; a theme that still has them loads with a warning and the
key is ignored ([ADR-0052](../docs/decisions.md#adr-0052-one-theme-one-look-achievements-inherit-the-themes-settings-popup-and-text)):

| Old key | Now |
| --- | --- |
| `default`, `categories`, `types` | The style keys at the top level |
| `display_time_ms` at the top level | `settings.display_time_ms` |
| `logo: { visible, radius }` | `game_icon: [visible, radius]` |
| `themes` at the top level (an Enhanced Achievements file) | The tiers in `achievements` |
| `achievements.settings` | The theme's `settings`; its `layout` is `achievements.layout` |
| `achievements.tiers` / `achievements.themes` | The tiers directly in `achievements` |
| A tier's `banner` / `box` | Its keys directly on the tier |
| A tier's `background_color` | `background` |
| A tier's `text.title` / `text.desc` style | The theme's `text.title` / `text.body` |
| `layout: "custom"` | A layout object |

## Settings

In a top-level `settings` object. For every toast, achievements included.

| Key | Format | Notes |
| --- | --- | --- |
| `position` | `"top_right"`, `"top_left"`, `"bottom_right"`, `"bottom_left"`, `"top_center"`, `"bottom_center"` | Screen corner. Unset: Steam's own corner (`bottom_right` for the banner). On desktop Steam's stacking is kept: the newest toast sits at the corner and older ones move inward |
| `animation` | `"slide"`, `"fade"`, `"up"`, `"down"`, `"ps5"`, `"none"`, or `{ "in": ..., "out": ... }` | Entrance and exit. One name sets both; in the object form an unset side is `slide` (in) or `fade` (out). Unset: Steam's own (slide in, fade out for the banner). `slide` and `ps5` move from the side of the corner (`ps5`: a short slide with a fade, vertical for the centred positions) |
| `display_time_ms` | ms, `1000`–`60000` | How long every toast stays. Unset: Steam's own per type. For the banner, how long it stays fully visible, between the end of its entrance and the start of its exit |
| `text_align` | `"left"`, `"center"`, `"right"` | Text alignment. Unset: left |

Position and animation apply on desktop, in the in-game overlay and in Big
Picture. With an `animation`, the toast does not travel with Steam's slide: it
appears at its place, and the exit ends when Steam closes the toast.

Big Picture has one toast place, which follows the toast on screen: the
theme's `position` and `popup.margin`, or, while an achievement banner shows,
the banner's `margin`.

## Style keys

At the top level of the theme.

| Key | Format | Notes |
| --- | --- | --- |
| `popup.background` | `["#hex", ...]` | One colour is solid, two or more a gradient |
| `popup.gradient_angle` | degrees | Default `135` (`90` for the banner) |
| `popup.border` | `[width_px, "#hex", radius_px]` | Width `0` = no stroke |
| `popup.glow` | `["#hex", spread_px, pulse_ms]` | Inner glow; `pulse_ms` `0` = steady. Not drawn on the banner |
| `popup.watermark` | `true` / `false` | Steam logo behind desktop toasts |
| `popup.margin` | CSS shorthand: `px`, `[vertical, horizontal]`, `[top, horizontal, bottom]` or `[top, right, bottom, left]` | Distance from the screen corner; only the sides the toast is anchored to count (`top_right` uses top and right; centred positions ignore left and right). Works with Steam's own corner too |
| `popup.padding` | CSS shorthand, as `margin` | Space inside the toast around the icon and text. Steam's is `10` on desktop; the banner's default `[6, 10]`. A toast keeps Steam's height (70 px on desktop, 40 px for Big Picture's short toast): the padding comes out of it, so a larger one leaves less room for the text |
| `popup.gap` | `px` or `[icon_to_text, between_rows]` | Steam's is `[12, 0]` on desktop; the banner's default `[10, 2]`. Keep `between_rows` small: a three-row toast (a download: title, game, "Ready to play") has about 52 px of text in a 70 px toast, so `10` (added twice) crops it at the top and bottom |
| `popup.scale` | `pct` or `[width_pct, height_pct]`, `25`–`400` | Banner only, for now. Size of the banner box; text and icons keep their own sizes |
| `popup.width` / `popup.height` | px | Banner only, for now. Base size before `scale`; default: the layout's own |
| `popup.layout` | A [layout](#achievementslayout) | Banner only, for now. `achievements.layout` wins over it |
| `font_family` | `"Name, Fallback"` | Plain font names only |
| `text.title` / `text.body` / `text.subtext` | `["#hex", size_pct, "bold"\|"regular"\|"italic"]` | Size is relative to Steam's default. The banner uses `title` for the achievement's name and `body` for its description |
| `game_icon` | `[visible, radius_px]` or `true` / `false` | The game's icon on the left of the toast, and its rounded corners (Steam's is square) |
| `header_icon` | `true` / `false` | Small icon before the title |
| `sound` | `["path", volume_pct]` or `false` | Every notification's sound (achievements too, unless their tier has its own); `false` mutes them; see File paths; `.mp3`, `.wav`, `.ogg` |

`margin` and `padding` take CSS's clockwise order: `[10, 5, 4, 7]` is 10 top,
5 right, 4 bottom, 7 left.

Colours accept `#rgb`, `#rrggbb`, `#rrggbbaa`. Invalid values are ignored
(logged as warnings) and that part stays stock.

## achievements

Optional. Replaces Steam's achievement toast with a themed banner: your
layout, icons and sound for each of four rarity tiers, on the theme's own
card. Leave it out and achievement toasts look like every other toast. A block
that is not an object is a warning, and achievement toasts then get the
notification style.

```jsonc
"achievements": {
  "layout": "ps5",                 // or an object: see achievements.layout
  "padding": [10, 15, 10, 10],     // any popup key, for every tier
  "normal":      { "icons": { ... }, "sound": ["assets/bronze.mp3", 80] },
  "magic":       { "threshold": 25.0, "background": ["#20262e", "#3a4454"], ... },
  "rare":        { "threshold": 10.0, "border": [2, "#e5a93c", 8], ... },
  "exceptional": { "text": { "title": "100% Complete", "desc": "You've unlocked all achievements!" } }
}
```

**The banner is layered**, each layer only listing what differs: the theme's
`popup`, then any popup key set directly in `achievements`, then `normal`, then
the tier. Position, animation, display time and text alignment are the
theme's `settings`; text styles are the theme's `text`.

### achievements.layout

A preset name, or an object that places each icon. Default `"default_steam"`.
`popup.layout` is used when this is unset.

- `"default_steam"`: achievement icon on the left, title and description stacked on the right (283 px wide).
- `"default_system_right"`: the same, plus the system icon pinned to the right edge (400 px).
- `"compact_pill"`: slim horizontal bar with icon and title, no description (48 px tall).
- `"ps5"`: PlayStation 5 trophy layout: achievement icon on the left, tier trophy before the title, description below, system icon on the right (400 px).
- An object (400 px): places each icon (`achievement`, `system`, `rarity`); the text is always the middle column:

```json
"layout": {
    "achievement": "left",
    "system": "right",
    "rarity": "title_left"
}
```

- **Outer zones**: `"left"`, `"right"` (also `"achievement_left"`, `"achievement_right"`: the same zones, placed after a `left`/`right` icon).
- **Sub-element anchors**: `"title_left"`, `"title_right"`, `"desc_left"`, `"desc_right"`.
  An icon anchored to a text line is sized to that line.
- Defaults: achievement `"left"`, system `"right"`, rarity `"title_left"`.
- `"center"` and a `"text"` key are accepted for older themes but place nothing.

### Tiers

One look per rarity tier, directly in `achievements`, all optional.

- **`normal`** (Bronze): the base tier. Every key here is the fallback for the other tiers.
- **`magic`** (Silver): used when the achievement's global unlock rate is ≤ `magic.threshold`.
- **`rare`** (Gold): used when the global unlock rate is ≤ `rare.threshold`.
- **`exceptional`** (Platinum): synthesized 100% completion banner triggered right after the final achievement in a game is unlocked (acting as a "fake platinum trophy", since Steam has no native 100% completion achievement).

Tier selection for real unlocks: `rare` → `magic` → `normal`. When the unlock
completes the game, the real unlock fires first with its own rarity tier,
followed 1.5 s later by the synthetic `exceptional` banner. When Steam gives
no global unlock rate (common for non-Steam games), the tier is `normal`.

> **Inheritance:** `magic`, `rare` and `exceptional` only list what differs from
> `normal`. Objects merge key by key; tuples and arrays are replaced whole.

### Tier keys

#### Popup keys

Any [popup key](#style-keys) the banner reads, as a plain key on the tier:
`background`, `gradient_angle`, `border`, `glow`, `margin`, `padding`, `gap`,
`scale`, `width`, `height`. For example
`"rare": { "threshold": 10, "border": [2, "#e5a93c", 8] }`.

#### `threshold` (number)

Global unlock percentage cutoff for `magic` and `rare`.

- `"threshold": 10.0` matches when 10% or fewer of players have the achievement.
- Recommended: `magic` = `25.0`, `rare` = `10.0`. Never inherited from `normal`.

#### `text`

The words only: `"title"` and `"desc"` strings, for `exceptional` (other tiers
always show the achievement's own name and description). Default: "100%
Complete" and "You've unlocked all achievements!". Their style is the theme's
`text.title` and `text.body`.

#### `icons`

Every slot takes `[source, scale_pct, ripple_ms]`, `[source, ripple_ms]`, or bare `source` as shorthand for `[source, 100, 0]`.

- **`source`**
    - `true`: show Steam's own asset (the achievement art, or Steam's logo for `system`).
    - `false`: hide the slot.
    - `"path"`: a custom `.png` or `.svg`.
- **`scale_pct`**: icon scaling relative to standard bounds (`100` = 100%, `50` = half size).
- **`ripple_ms`**: `0` is static; `> 0` loops an expanding water-ripple ring behind the icon at that period (e.g. `2000` = 2-second pulse).

Slots:

- **`achievement`**: the achievement's own artwork. In `exceptional`, can specify a custom game completion badge/icon image.
- **`system`**: platform logo (Steam, PlayStation, …).
- **`rarity`**: tier emblem (bronze, silver, gold, or the Platinum 100% completion badge).

#### `sound`

`["path", volume_pct]`: `.mp3`, `.wav` or `.ogg`; volume `0`–`100`. Omit it
(or `null`) to use the theme's notification `sound`, or Steam's own chime
without one. A file that is missing or fails to load falls back the same way,
never to silence.

## File paths

- A relative path resolves against the theme file's own folder, so a theme and
  its `assets/` folder can be shared as one directory.
- An absolute path (`C:/…`) is allowed for personal themes, but makes the theme
  non-portable.
- The backend loads each asset once when the theme is (re)loaded, never per
  toast. Allowed types: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`,
  `.mp3`, `.wav`, `.ogg`, up to 8 MB each. A missing, oversized or disallowed
  file keeps Steam's own (or, for an icon, hides it).

## Plugin settings

Not part of a theme. Configured in the plugin's settings panel (Millennium
sidebar) and stored by Millennium. [settings.json](settings.json) holds the
shipped defaults; you never need to edit it.

- **`theme`**: the active theme's file name without `.jsonc`/`.json` (with it
  for the second of a `.json` / `.jsonc` pair, so either can be picked), or
  `<steam>` for Steam default (the shipped default: no theme).
- **`queue.enabled`**: "Notifications queue", off by default. One notification
  on screen at a time, of every kind, instead of Steam's stack of up to three:
  the next one appears when the previous one has gone, each with its own sound.
  It uses Steam's own "show alone" rule for every notification type. Applies on
  desktop and in the in-game overlay (Big Picture already shows one toast at a
  time). Achievement banners also wait for each other (up to 5 queued; past
  that a new one shows at once rather than being dropped).
- **`screenshot`** / **`recording`**: captures on unlock, off by default (they
  write files into your library). Never set by a theme.

Themes load from two folders; a user theme with the same file name wins:

- `<Steam>/millennium/config/enhanced-notifications/themes/` (yours; survives updates)
- `<plugin>/themes/` (bundled; replaced on update)

## Sharing themes

A theme is one `.jsonc`/`.json` file plus the assets it references. Put them in
one folder with relative paths (`assets/gold.png`) and share that folder. To
install, drop it into the themes folder and pick it in the settings panel.

## Known limitations

- **Big Picture** uses Steam's own 300×80 toast frame for the banner too:
  `scale` does not apply there.
- **Notifications queue.** With it on, a burst of notifications drains one at
  a time, so the last one can appear several display times after it arrived.
