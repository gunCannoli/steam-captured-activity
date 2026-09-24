# Theme Schema & Specifications (`themes.md`)

Full breakdown of every section, key, and array format in the `enhanced-achievements` theme schema.

---

### Root Configuration

#### `settings`

Global display and capture behavior applied to achievement notifications.

- **`layout`**: Arranges the internal components inside the banner.
  - `"default_steam"`: Classic layout (Icon on the left, Title and Description stacked on the right).
  - `"default_system_right"`: Icon on the left, text block in the middle, and platform/system icon pinned to the right edge.
  - `"compact_pill"`: Slim horizontal bar with icon and title.
  - `"custom"`: Unlocks layout customization using template slots.

- **`position`**: Screen anchor point where the notification appears (`"topright"`, `"topleft"`, `"bottomright"`, `"bottomleft"`, `"topcenter"`, `"bottomcenter"`).
- **`display_time_ms`**: Time in milliseconds the banner remains on-screen before the exit animation triggers (e.g., `4000` = 4 seconds).
- **`animation`**: Transition style for banner entrance and exit (`"slide"`, `"fade"`, `"up"`, `"down"`).

- **`screenshot`**: Auto-screenshot capture configuration on achievement unlock:
  - **`enabled`**: `boolean` (`true` to capture, `false` to disable).
  - **`delay_ms`**: `number` (delay in milliseconds after unlock before taking screenshot, e.g. `500` ms).

- **`recording`**: Auto-clip replay capture configuration via Steam Game Recording:
  - **`enabled`**: `boolean` (`true` to save clip, `false` to disable).
  - **`duration_s`**: `number` (clip duration in seconds, e.g. `15` or `30` seconds preceding the unlock).
  - **`delay_ms`**: `number` (delay in milliseconds after unlock before saving clip, e.g. `1000` ms).
  - **`add_timeline_marker`**: `boolean` (`true` to place an achievement icon marker on Steam's active recording timeline).

---

### Themes & Inheritance Model

#### `themes`

Defines the visual and audio profiles based on achievement rarity and completion.

- **`normal`**: The master base theme (Bronze tier). Every field defined here acts as the default fallback.
- **`magic`**: Silver tier. Unlocks when an achievement's global unlock rate is $\le$ `magic.threshold`.
- **`rare`**: Gold tier. Unlocks when an achievement's global unlock rate is $\le$ `rare.threshold`.
- **`exceptional`**: Platinum tier. Automatically triggers when unlocking the final achievement that brings the game to 100% completion.

> **Inheritance Rule:** `magic`, `rare`, and `exceptional` only need to specify values that differ from `normal`. Omitted keys inherit directly from `normal`.

---

### Object & Tuple Specifications

#### `threshold` (Number)

The global unlock percentage cutoff.

- Example: `"threshold": 10.0` triggers if 10% or fewer of all Steam players have unlocked the achievement.
- Recommended defaults:
  - `magic` (Silver): `25.0` (top 25% or rarer)
  - `rare` (Gold): `10.0` (top 10% or rarer)

---

#### `box`

Controls the geometry, colors, borders, and backdrop shadows of the notification card.

- **`scale`**: `[width_pct, height_pct]`
  - Stretches or shrinks the banner size relative to default dimensions (`[100, 100]` = standard size, `[150, 150]` = 1.5× scale).

- **`background_color`**: `["color_1", "color_2", ...]`
  - Array of hex strings. Providing one color produces a solid background; providing two or more automatically creates a smooth gradient.

- **`gradient_angle`**: Angle in degrees for the background gradient (`90` = left-to-right, `180` = top-to-bottom, `135` = diagonal).
- **`border`**: `[width_px, color_hex, border_radius_px]`
  - `width_px`: Border stroke thickness (`0` disables border).
  - `color_hex`: Hex color of the border line.
  - `border_radius_px`: Corner roundness (`0` = sharp square, `25` = rounded capsule corners).

- **`glow`**: `[glow_color_hex, spread_radius_px, pulse_speed_ms]`
  - `glow_color_hex`: Color of the ambient shadow behind the card.
  - `spread_radius_px`: How far the glow extends outward (`0` turns it off).
  - `pulse_speed_ms`: Duration of the breathing animation cycle in milliseconds. Set to `0` for a steady, static glow; set to a value like `1500` for a 1.5-second pulse.

---

#### `text`

Controls typography styling for both copy layers.

- **`title`**: `[color_hex, font_size_pct, font_style]`
- **`desc`**: `[color_hex, font_size_pct, font_style]`
  - `color_hex`: Font color.
  - `font_size_pct`: Scaling factor relative to the base font size (`100` = base size, `110` = 10% larger).
  - `font_style`: Font rendering format: `"bold"`, `"regular"`, or `"italic"`.

---

#### `icons`

Manages icons, badges, custom assets, and ripple effects. Every asset follows the tuple format:

`[source_target, ripple_speed_ms]`

- **First Value (`source_target`)**:
  - `true`: Displays the original Steam/game asset.
  - `false`: Hides the icon entirely.
  - `"file_path"`: Path to a custom `.svg` or `.png` asset to replace the default icon.

- **Second Value (`ripple_speed_ms`)**:
  - Controls the speed of an expanding radial pulse behind the icon.
  - `0`: Static icon (no animation).
  - `> 0`: Loop duration in milliseconds (e.g., `1200` plays an expanding ripple wave every 1.2 seconds).

**Supported Icon Slots:**

- **`achievement`**: The square artwork of the unlocked achievement.
- **`system`**: Platform logo (such as the white Steam icon, PlayStation logo, etc.).
- **`rarity`**: The trophy/tier emblem (Bronze, Silver, Gold, or 100% badge).
- **`exceptional`**: Special standalone badge asset reserved for 100% game completion.

---

#### `sound`

Manages audio playback on unlock.

- Format: `["file_path", volume_pct]`
  - `"file_path"`: Local file path to the audio file (`.mp3`, `.wav`, or `.ogg`).
  - `volume_pct`: Output volume level from `0` (silent) to `100` (full volume).

---

#### Tier Override Options

In addition to `box`, `text`, `icons`, and `sound`, tiers may optionally override capture settings:

- **`screenshot`**: `{ "enabled": boolean, "delay_ms": number }`
- **`recording`**: `{ "enabled": boolean, "duration_s": number, "delay_ms": number }`

For example, a user may configure `recording` to capture clips **only** for `rare` and `exceptional` unlocks.
