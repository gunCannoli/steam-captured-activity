# Theme Schema (`themes.md`)

Reference for every section, key, and tuple format in an `enhanced-achievements`
theme file. The bundled default is [themes/steam_tiers.json](themes/steam_tiers.json)
(colour-coded tiers, no local asset paths). Fuller, asset-based examples live in
[examples/](examples/) — see [examples/README.md](examples/README.md) for how to
use one.

A **theme** only describes how an unlock looks and sounds. What the plugin does
(which theme is active, feature toggles, auto-capture defaults) is a plugin setting,
configured in the plugin's settings panel — see [Plugin settings](#plugin-settings).
Capture settings are never placed inside theme files.

---

## Root: `settings`

Display behaviour for this theme's banners.

- **`layout`**: How the banner's parts are arranged.
    - `"ps5"`: Authentic PlayStation 5 trophy layout (achievement icon on the left, tier trophy icon anchored left of the title, description below, system/PlayStation icon pinned on the right).
    - `"default_steam"`: Achievement icon on the left, title and description stacked on the right.
    - `"default_system_right"`: Achievement icon on the left, text in the middle, system icon pinned to the right edge.
    - `"compact_pill"`: Slim horizontal bar with icon and title.
    - `"custom"`: Flexible anchor-based layout defined via the root `layout` mapping object.
- **`position`**: Screen anchor: `"top_right"`, `"top_left"`, `"bottom_right"`, `"bottom_left"`, `"top_center"`, `"bottom_center"`. The toast window is dynamically repositioned to the chosen screen location, offset inward by `margin`.
- **`display_time_ms`**: How long the banner stays fully visible, between the end of its entrance and the start of its exit animation (e.g. `4000` = 4 s). On desktop the banner owns its timing, so entrance and exit are never cut short. Unset keeps Steam's own duration.
- **`animation`**: Entrance and exit transition. Either one name for both
  (`"fade"` — the same as before), `"none"` (no animation for that state), or
  independent control: `{"in": "slide", "out": "fade"}`. Default when omitted:
  `{"in": "slide", "out": "fade"}`.
    - `"slide"`, `"up"`, `"down"`: enter and exit both move (the exit is the
      reverse motion of the entrance), not just fade.
    - `"ps5"`: slides in from the screen edge the banner is anchored to (and
      slides back out the same way) plus a fade, like a PS5 trophy popup.
      `top_center`/`bottom_center` slide vertically instead, since they have
      no horizontal edge to anchor to.
- **`text_align`**: Text alignment for titles and descriptions: `"left"` (default), `"center"`, or `"right"`.

---

## Root: `layout` (Optional, used with `"layout": "custom"`)

Configures anchor positioning for internal elements:
```json
"layout": {
    "achievement": "left",
    "system": "right",
    "text": "center",
    "rarity": "title_left"
}
```

- **Fixed Zones**: `"left"`, `"right"`, `"center"`.
- **Sub-Element Anchors**: `"title_left"`, `"title_right"`, `"desc_left"`, `"desc_right"`.
  When an element is anchored to another (such as `"rarity": "title_left"`), its height is automatically matched to the reference element's size (e.g. font line-height).

---

## Root: `themes`

One visual and audio profile per rarity tier.

- **`normal`** (Bronze): the base tier. Every key defined here is the fallback for the other tiers.
- **`magic`** (Silver): used when the achievement's global unlock rate is ≤ `magic.threshold`.
- **`rare`** (Gold): used when the global unlock rate is ≤ `rare.threshold`.
- **`exceptional`** (Platinum): synthesized 100% completion banner triggered right after the final achievement in a game is unlocked (acting as a "fake platinum trophy", since Steam has no native 100% completion achievement).

Tier selection for real unlocks: `rare` → `magic` → `normal`. When the unlock completes the game, the real unlock fires first with its own rarity tier, followed 1.5s later by the synthetic `exceptional` banner.
When Steam gives no global unlock rate (common for non-Steam games), the tier is `normal`.

> **Inheritance:** `magic`, `rare` and `exceptional` only list what differs from
> `normal`. Objects merge key by key; tuples and arrays are replaced whole.

---

## Tier keys

### `threshold` (number)

Global unlock percentage cutoff for `magic` and `rare`.

- `"threshold": 10.0` matches when 10% or fewer of players have the achievement.
- Recommended: `magic` = `25.0`, `rare` = `10.0`.

### `banner` (formerly `box`)

Geometry, colours, border, glow, margin, padding, and gap of the banner. (The key `box` is maintained as a backward-compatible alias).

- **`scale`**: `[width_pct, height_pct]` or scalar `pct` — size of the banner **box** relative to the default (`[100, 100]` = standard size). Text and icons keep their own sizes (`text.*` size %, icon `scale_pct`); they do not grow or shrink with the box.
- **`width`**: *(optional)* Base banner width in px (defaults to 400 for `ps5` and `custom`, 283 for standard Steam).
- **`height`**: *(optional)* Base banner height in px (defaults to 70 for normal cards, 48 for `compact_pill`).
- **`margin`**: `[vertical_px, horizontal_px]` or one number — distance from the anchor corner. With `top_right` and `5`, the banner sits 5 px left of the right edge and 5 px below the top. The horizontal margin is ignored for `top_center`/`bottom_center`.
- **`padding`**: `[vert_px, horiz_px]` or scalar `px` — internal breathing room pushing banner content inward (e.g. `[6, 12]`).
- **`gap`**: `[col_gap_px, row_gap_px]` or scalar `px` — flexbox spacing between layout zones, columns, and text rows (e.g. `[10, 2]`).
- **`background_color`**: `["#hex", ...]` — one colour is solid; two or more make a smooth gradient.
- **`gradient_angle`**: degrees (`90` = left→right, `180` = top→bottom, `135` = diagonal).
- **`border`**: `[width_px, "#hex", radius_px]` — `width_px` `0` disables stroke; `radius_px` `0` is square, `15` is rounded, `25` is capsule.
- **`glow`**: *(parsed, currently has no visual effect — the outline-glow
  render was removed; kept in the schema so existing theme files do not warn
  or break)*.

Colours accept `#rgb`, `#rrggbb` and `#rrggbbaa`.

### `text`

- **`title`** and **`desc`**: `["#hex", size_pct, style]` or custom string overrides.
    - `size_pct`: relative to the base font size (`100` = base, `120` = 20% larger).
    - `style`: `"bold"`, `"regular"` or `"italic"`.
    - Custom strings: In `exceptional` (or any tier), `"title": "100% Complete"` and `"desc": "You've unlocked all achievements!"` specify the exact headline and subtitle text.

### `icons`

Every slot takes `[source, scale_pct, ripple_ms]`, `[source, ripple_ms]`, or bare `source` as shorthand for `[source, 100, 0]`.

- **`source`**
    - `true`: show Steam's own asset (the achievement art, or Steam's logo for `system`).
    - `false`: hide the slot.
    - `"path"`: a custom `.png` or `.svg`.
- **`scale_pct`**: icon scaling relative to standard bounds (`100` = 100%, `50` = half size).
- **`ripple_ms`**: `0` is static; `> 0` loops an expanding water-ripple ring behind the icon at that period (e.g. `2000` = 2-second pulse). The ring starts as a ring at the icon's own edge and expands outward (not a pre-inflated glow).

Slots:

- **`achievement`**: the achievement's own artwork. In `exceptional`, can specify a custom game completion badge/icon image.
- **`system`**: platform logo (Steam, PlayStation, …).
- **`rarity`**: tier emblem (bronze, silver, gold, or the Platinum 100% completion badge).

### `sound`

`["path", volume_pct]` — `.mp3`, `.wav` or `.ogg`; volume `0`–`100`.
Omit it (in every tier) to keep Steam's own chime. A file that is missing or
fails to load also falls back to Steam's chime — never to silence.

---

## File paths

- A relative path resolves against the theme file's own folder, so a theme and
  its `assets/` folder can be shared as one directory.
- An absolute path (`C:/…`) is allowed for personal themes, but makes the theme
  non-portable.
- The frontend cannot read local files directly; the backend loads each asset
  once when the theme is (re)loaded, never per unlock.
- Allowed types: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.mp3`, `.wav`,
  `.ogg`, up to 8 MB each.

---

## Plugin settings

Not part of a theme. Configured in the plugin's settings panel (Millennium sidebar) and
stored by Millennium. [settings.json](settings.json) holds the shipped defaults;
you never need to edit it manually.

```json
{
    "theme": "",
    "queue": { "enabled": false },
    "screenshot": { "enabled": false, "delay_ms": 500 },
    "recording": {
        "enabled": false,
        "duration_s": 15,
        "delay_ms": 0,
        "add_timeline_marker": false
    }
}
```

- **`theme`**: file name (without `.json`) of the active theme in `themes/`, or
  `""` for **Steam default** — no theme loaded, Steam's own stock toast and
  chime, untouched — also by enhanced-notifications, which leaves achievement
  toasts to this plugin whenever it is installed. `""` is the shipped default; the settings panel's Theme
  dropdown shows it as "Steam default". Screenshot/recording captures still
  work with Steam default selected — they're independent of the banner.
- **`queue.enabled`**: one achievement banner at a time, off by default. A
  burst of unlocks is shown one after another in arrival order, each with its
  own sound when its banner appears, at the same spot. Up to 5 can wait; past
  that a new one shows at once rather than being dropped. Applies to themed
  banners on desktop and in the in-game overlay (Big Picture already shows one
  toast at a time).
- **`screenshot`** / **`recording`**: capture defaults, off by default (they write files into
  your library). All capture settings are global to the plugin and never overridden by themes.

Banner and sound theming are no longer separate on/off toggles — they follow the
active theme automatically. Once a theme is selected (anything but Steam
default), the banner is always themed; sound is themed only for tiers the
theme actually defines a sound clip for, and falls back to Steam's own chime
otherwise (including if the theme itself defines no sound at all).

The panel also has **Preview** buttons (one per tier), **Reload themes** and
**Open themes folder**, so the theme workflow is: edit the JSON → Reload → Preview.

Themes load from two folders; a user theme with the same name wins:

- `<Steam>/millennium/config/enhanced-achievements/themes/` (yours; survives updates)
- `<plugin>/themes/` (bundled; replaced on update)

## Sharing themes

A theme is one `.json` file plus the assets it references. Put them in one
folder with relative paths (`assets/gold.png`) and share that folder. To install,
drop it into the themes folder and pick it in the settings panel.

## Known limitations

- **Big Picture** uses Steam's own 300×80 toast frame and placement. `scale`
  and `position` do not apply there; only the desktop and in-game overlay
  toast windows are resized and repositioned.
