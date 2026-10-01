# Theme Schema (`themes.md`)

A theme restyles Steam's own toasts. **One style for every notification**, so
toasts stay consistent. Every key is optional; anything unset stays Steam's own.
An optional [`achievements`](#achievements) block replaces achievement toasts
with a themed banner per rarity tier; without it, achievement toasts get the
same style as every other toast.

**[themes/theme.jsonc](themes/theme.jsonc) is the commented version of this
page**: every option, in a working theme you can copy and trim. Also bundled:
[steam_midnight](themes/steam_midnight.json) (no achievement banner),
[ps5](themes/ps5.jsonc) and [steam_tiers](themes/steam_tiers.json)
(colour-coded tiers). Fuller, asset-based examples are in
[examples/](examples/).

**File format:** `.jsonc` or `.json`. Both accept JSONC: `//` and `/* */`
comments and trailing commas. If a folder has both `name.jsonc` and
`name.json`, the `.jsonc` is used.

```jsonc
{
  "settings": { "position": "top_right", "animation": "ps5", "display_time_ms": 4000 },
  "popup":    { "background": ["#0e141b", "#1b2838"], "border": [1, "#66c0f455", 6], "margin": 10, "padding": [8, 12] },
  "text":     { "title": ["#66c0f4", 100, "bold"] },
  "logo":     { "radius": 6 },
  "sound":    false,
  "achievements": {
    "settings": { "layout": "ps5" },
    "tiers": { "normal": { "icons": { "rarity": "assets/trophy_bronze.svg" } }, "rare": { "threshold": 10 } }
  }
}
```

The older `default`, `categories` and `types` blocks are gone; a theme that
still has them loads with a warning and they are ignored.

A theme only describes how toasts look and sound. What the plugin does (which
theme is active, the achievement queue, captures on unlock) is a plugin
setting, in the settings panel: see [Plugin settings](#plugin-settings).

## Settings

In a top-level `settings` object.

| Key | Format | Notes |
| --- | --- | --- |
| `position` | `"top_right"`, `"top_left"`, `"bottom_right"`, `"bottom_left"`, `"top_center"`, `"bottom_center"` | Screen corner. Unset: Steam's own corner. On desktop Steam's stacking is kept: the newest toast sits at the corner and older ones move inward |
| `animation` | `"slide"`, `"fade"`, `"up"`, `"down"`, `"ps5"`, `"none"`, or `{ "in": ..., "out": ... }` | Entrance and exit. One name sets both; in the object form an unset side is `slide` (in) or `fade` (out). Unset: Steam's own. `slide` and `ps5` move from the side of the corner (`ps5`: a short slide with a fade, vertical for the centred positions) |
| `display_time_ms` | ms, `1000`–`60000` | How long every toast stays. Unset: Steam's own per type |

Position and animation apply on desktop, in the in-game overlay and in Big
Picture. With an `animation`, the toast does not travel with Steam's slide: it
appears at its place, and the exit ends when Steam closes the toast.

Big Picture has one toast place, which follows the toast on screen: the
theme's `position` and `popup.margin`, or, while an achievement banner shows,
the banner's position and its tier's `margin`.

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
| `sound` | `["path", volume_pct]` or `false` | Every notification's sound (achievements too, unless their tier has its own); `false` mutes them; see File paths; `.mp3`, `.wav`, `.ogg` |

`margin` and `padding` take CSS's clockwise order: `[10, 5, 4, 7]` is 10 top,
5 right, 4 bottom, 7 left.

Colours accept `#rgb`, `#rrggbb`, `#rrggbbaa`. Invalid values are ignored
(logged as warnings) and that part stays stock.

## achievements

Optional. Replaces Steam's achievement toast with a themed banner: your
layout, colours, icons and sound for each of four rarity tiers. Leave it out
and achievement toasts look like every other toast. A block that cannot be
used (no `tiers.normal`) is a warning, and achievement toasts then get the
notification style.

```jsonc
"achievements": {
  "settings": { "layout": "custom", "text_align": "left" },  // + position / animation / display_time_ms to override the theme's
  "layout":   { "achievement": "left", "system": "right", "rarity": "title_left" },
  "tiers": {
    "normal":      { "banner": { ... }, "text": { ... }, "icons": { ... }, "sound": ["assets/bronze.mp3", 80] },
    "magic":       { "threshold": 25.0, ... },
    "rare":        { "threshold": 10.0, ... },
    "exceptional": { "text": { "title": "100% Complete", "desc": "You've unlocked all achievements!" } }
  }
}
```

An Enhanced Achievements theme file (the plugin merged into this one) works
as an `achievements` block as it is: paste its `settings`, `layout` and
`themes` inside `"achievements": { ... }`. `themes` is read as `tiers`.

### achievements.settings

- **`layout`**: How the banner's parts are arranged.
    - `"ps5"`: Authentic PlayStation 5 trophy layout (achievement icon on the left, tier trophy icon anchored left of the title, description below, system/PlayStation icon pinned on the right).
    - `"default_steam"` (default): Achievement icon on the left, title and description stacked on the right.
    - `"default_system_right"`: Achievement icon on the left, text in the middle, system icon pinned to the right edge.
    - `"compact_pill"`: Slim horizontal bar with icon and title.
    - `"custom"`: Flexible anchor-based layout defined via the `layout` mapping object.
- **`text_align`**: Text alignment for titles and descriptions: `"left"` (default), `"center"`, or `"right"`.
- **`position`**, **`animation`**, **`display_time_ms`**: the same values as the
  theme's [settings](#settings), which the banner uses unless these are set
  here. Without either: `bottom_right`, slide in and fade out, Steam's own
  duration. The banner is placed by the plugin, at its `position` offset inward
  by its tier's `margin`; `display_time_ms` is how long it stays fully visible,
  between the end of its entrance and the start of its exit.

### achievements.layout

Used with `"layout": "custom"`. Places each icon (`achievement`, `system`,
`rarity`); the text is always the middle column:

```json
"layout": {
    "achievement": "left",
    "system": "right",
    "rarity": "title_left"
}
```

- **Outer zones**: `"left"`, `"right"` (also `"achievement_left"`, `"achievement_right"`: the same zones, placed after a `left`/`right` icon).
- **Sub-Element Anchors**: `"title_left"`, `"title_right"`, `"desc_left"`, `"desc_right"`.
- `"center"` and a `"text"` key are accepted for older themes but place nothing.
  When an element is anchored to another (such as `"rarity": "title_left"`), its height is automatically matched to the reference element's size (e.g. font line-height).

### achievements.tiers

One visual and audio profile per rarity tier (`themes` is accepted as an older
name).

- **`normal`** (Bronze): the base tier, required. Every key defined here is the fallback for the other tiers.
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

#### `threshold` (number)

Global unlock percentage cutoff for `magic` and `rare`.

- `"threshold": 10.0` matches when 10% or fewer of players have the achievement.
- Recommended: `magic` = `25.0`, `rare` = `10.0`. Never inherited from `normal`.

#### `banner` (formerly `box`)

Geometry, colours, border, glow, margin, padding, and gap of the banner. (The key `box` is maintained as a backward-compatible alias).

- **`scale`**: `[width_pct, height_pct]` or scalar `pct`: size of the banner **box** relative to the default (`[100, 100]` = standard size). Text and icons keep their own sizes (`text.*` size %, icon `scale_pct`); they do not grow or shrink with the box.
- **`width`**: *(optional)* Base banner width in px (defaults to 400 for `ps5` and `custom`, 283 for standard Steam).
- **`height`**: *(optional)* Base banner height in px (defaults to 70 for normal cards, 48 for `compact_pill`).
- **`margin`**: CSS shorthand, clockwise, as `popup.margin`: distance from the anchor corner. With `top_right` and `5`, the banner sits 5 px left of the right edge and 5 px below the top. Only the sides the banner is anchored to count; the horizontal margins are ignored for `top_center`/`bottom_center`.
- **`padding`**: CSS shorthand, clockwise (e.g. `[10, 5, 4, 7]`: 10 top, 5 right, 4 bottom, 7 left): internal breathing room pushing banner content inward.
- **`gap`**: `[col_gap_px, row_gap_px]` or scalar `px`: flexbox spacing between layout zones, columns, and text rows (e.g. `[10, 2]`).
- **`background_color`**: `["#hex", ...]`: one colour is solid; two or more make a smooth gradient.
- **`gradient_angle`**: degrees (`90` = left→right, `180` = top→bottom, `135` = diagonal).
- **`border`**: `[width_px, "#hex", radius_px]`: `width_px` `0` disables stroke; `radius_px` `0` is square, `15` is rounded, `25` is capsule.
- **`glow`**: *(parsed, currently has no visual effect: the outline-glow
  render was removed; kept in the schema so existing theme files do not warn
  or break)*.

#### `text`

- **`title`** and **`desc`**: `["#hex", size_pct, style]` or custom string overrides.
    - `size_pct`: relative to the base font size (`100` = base, `120` = 20% larger).
    - `style`: `"bold"`, `"regular"` or `"italic"`.
    - Custom strings (`exceptional` only; other tiers always show the achievement's own name and description): `"title": "100% Complete"` and `"desc": "You've unlocked all achievements!"` set the words, while the style is still inherited from `normal`. `title_text` / `desc_text` are the same thing, spelled out.
- **`align`**: overrides `achievements.settings.text_align` for this tier.

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

- **`theme`**: file name (without `.jsonc`/`.json`) of the active theme.
- **`style.enabled`** / **`sound.enabled`** / **`duration.enabled`**: "Themed
  style", "Themed sounds", "Themed display time". Off: Steam's own look
  (achievement banners included), sounds or display time.
- **`queue.enabled`**: one achievement banner at a time, off by default. A
  burst of unlocks is shown one after another in arrival order, each with its
  own sound when its banner appears, at the same spot. Up to 5 can wait; past
  that a new one shows at once rather than being dropped. Applies to banners on
  desktop and in the in-game overlay (Big Picture already shows one toast at a
  time).
- **`screenshot`** / **`recording`**: captures on unlock, off by default (they
  write files into your library). Never set by a theme.

Themes load from two folders; a user theme with the same name wins:

- `<Steam>/millennium/config/enhanced-notifications/themes/` (yours; survives updates)
- `<plugin>/themes/` (bundled; replaced on update)

## Sharing themes

A theme is one `.jsonc`/`.json` file plus the assets it references. Put them in
one folder with relative paths (`assets/gold.png`) and share that folder. To
install, drop it into the themes folder and pick it in the settings panel.

## Known limitations

- **Big Picture** uses Steam's own 300×80 toast frame for the banner too:
  `scale` does not apply there.
- **Achievement queue and other toasts.** Steam shows at most 3 desktop toasts
  at once, and a queued achievement keeps its (invisible) toast open until its
  turn. While a burst of 3+ unlocks drains, a friend or download toast can
  wait for a free spot (about one banner's display time).
