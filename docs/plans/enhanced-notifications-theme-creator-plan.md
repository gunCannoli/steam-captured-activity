# enhanced-notifications: Theme Creator (design and phased plan)

**Status (2026-10-04):** design, nothing coded. Waiting for the user's answers to § 3.2, then the spikes in § 8.
**This plan's job:** what the Theme Creator is, how it looks, how it fits the plugin's architecture, and the order it
is built in. It is the **feature design**. Each phase in § 9 gets its own mechanical plan (literal before/after blocks,
the [plan writing standard](README.md)) when it starts, written against the files as they are then. Writing those
blocks now, for about 3,000 lines of new code, would go stale before phase 2.

Read first: [docs/enhanced-notifications.md](../enhanced-notifications.md) (layers, owners, how to add a feature),
[themes.md](../../enhanced-notifications/themes.md) (the theme format the creator writes),
[plugins.md guardrails 12, 17, 18](../plugins.md#guardrails--regression-prevention-must-read-before-writing-code).

---

## 1. What the user asked for

| # | Requirement |
| --- | --- |
| R1 | A **Theme Creator** button in the settings panel's Theme section, above "Reload themes" |
| R2 | It opens a **big modal** |
| R3 | Three ways in: **start from a bundled theme as a template**, **edit one of my own themes**, **start fresh** |
| R4 | A **preview section** in the modal that shows the theme on several toasts at once |
| R5 | Preview sets: **4 chosen notification types**, **4 random**, **4 achievement tiers**, and similar sets |
| R6 | **Sounds can be previewed** |
| R7 | The AI-generated sound packs in `enhanced-notifications/themes/SteamStation/custom/sfx/` are offered in the creator |
| R8 | Those sounds are **not named ps4 / ps5 / platinum** (proprietary names, only ever a reference) |

Implied by the plugin's rules (not asked, but required):

| # | Requirement | Why |
| --- | --- | --- |
| R9 | The creator writes **only** theme files in the user themes folder, never into the bundled `themes/` | The bundled folder is replaced on update (`backend/main.lua` header, themes.md § Plugin settings) |
| R10 | A saved theme is an ordinary `.jsonc` theme, loadable and shareable without the creator | ADR-0052/0053: themes are hand-editable, shareable JSONC |
| R11 | Every key can be **left unset** (= Steam's own), not only changed | themes.md § Defaults: unset means Steam's own, and "Steam default" is a theme |
| R12 | Opening the creator, editing and previewing write nothing into Steam | Only surfaces write into Steam (enhanced-notifications.md § Layers) |

---

## 2. What exists today (evidence)

**The Theme section** (`frontend/settings/settings-panel.tsx` `ThemeSection`, lines 98-185): a dropdown block, then one
block with two `ButtonRow`s, "Reload themes" (`refresh()` + `reloadTheme()`) and "Themes folder" (`rpc.openThemesFolder()`).

**Theme pipeline, all reusable as-is:**

| Piece | File | What the creator reuses it for |
| --- | --- | --- |
| `parseJsonc(text)` | `theme/jsonc.ts` | Opening a theme file, and the Code section |
| `resolveTheme(raw)` (pure) | `theme/theme.ts:259` | Turning the draft into exactly what the plugin would use, with its `warnings` and `assetPaths` |
| `buildCss(style, sel)` (pure) | `theme/theme.ts:332` | The preview's toast CSS. Hardcodes the root `body[data-en-type]` (line 333) |
| `buildAnimationCss` (pure) | `theme/theme.ts:449` | The preview's entrance and exit |
| `resolveAchievementTheme`, `TIERS`, `LAYOUT_PRESETS`, `BANNER_KEYS` | `theme/achievements.ts` | The Achievements section and tier inheritance |
| `POSITIONS`, `ANIMATIONS`, `TEXT_ALIGNS` | `theme/schema.ts` | Dropdown options (one source of names) |
| `BANNER_CSS` and the banner's markup | `banner/styles.ts`, `surfaces/banner/themed-toast.tsx:233-405` | The achievement preview. The markup is inside `ThemedBanner`, mixed with the queue, the window pin and the popup hold |
| `audio()` (the shared `AudioContext`) | `theme/active-theme.ts` | Playing sounds in the preview |
| `resolveToastSelectors()` | `steam/selectors.ts` | Steam's hashed toast classes, for the preview's mock toasts |
| `showDialog(modal, { popupWidth, popupHeight })` | `steam/modal.ts` | Opening the modal at a set size on desktop |
| `previewOptions()`, `pickPreview()` | `surfaces/preview/index.ts`, `surfaces/preview/pick.ts` | The notification types and the random pick |
| `previewTier(tier)` | `surfaces/toasts/post.ts:95` | "Test on screen" for achievements |

**Backend** (`backend/main.lua`): `ListThemes`, `LoadTheme`, `LoadAssets` (data URLs, MIME allow-list, 8 MB cap),
`OpenThemesFolder`. **Nothing writes a file.** `utils.write_file(path, content)` exists in the shared `_lib`
(steam-cartridges uses it with a tmp file and a rename, `steam-cartridges/backend/media_store.lua:32`).
`fs.copy`, `fs.rename`, `fs.create_directories` exist (`backend/_lib/fs.lua`).

**SDK** (`@steambrew/client`, checked in `node_modules/@steambrew/client/build`): `SidebarNavigation` (Steam's own
settings-page layout: a left page list and a content area), `ColorPickerModal` (returns an **HSL** string),
`SliderField`, `Dropdown`, `TextField`, `Toggle`, `Field`, `Focusable`, `ModalRoot`, `Tabs`.

**The sound packs** (`themes/SteamStation/custom/sfx/`, 17 zips, untracked except 10): every zip has the same shape,
three cues, each as WAV (48 kHz, 16-bit stereo) and MP3, plus a README:

| Cue in the zip | Length | Character (README) |
| --- | --- | --- |
| `PS4/…/trophy_ps4_<mood>` | ~0.95 s | short, punchy chime |
| `PS5/…/trophy_ps5_<mood>` | ~1.40 s | warm swell, open chord bloom |
| `PLATINUM/…/trophy_platinum_<mood>` | ~2.20 s | multi-stage fanfare |

MP3 per pack ≈ 190 KB (all 17: ≈ 3.2 MB). WAV per pack ≈ 870 KB (all 17: ≈ 15 MB).

**The trap this design avoids:** a theme's relative paths resolve against **its own folder** (themes.md § File paths).
A bundled template such as `ps5.jsonc` points at `PlayStation/bronze.png` inside the bundled folder. Saved as-is into
the user folder, every one of those paths breaks. So saving must **copy the assets the theme uses next to the saved
theme and rewrite the paths** (§ 6.6). The same holds for the sound library.

---

## 3. Decisions

### 3.1 Decided in this plan (recommended; change any of them before phase 1)

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | The creator saves to `<userDir>/<name>.jsonc`, its assets to `<userDir>/<name>/`. Never the bundled folder | R9. The pair is the "one folder to share" unit themes.md already describes |
| D2 | Saving **copies every asset the theme references** from outside `<userDir>/<name>/` into it and rewrites the paths to `<name>/<file>`. Absolute paths the user wrote by hand stay as they are | Fixes the trap in § 2; the saved theme is self-contained and shareable (R10) |
| D3 | The draft **is the raw theme JSON**, edited by path (`set` / `unset`). The preview runs the plugin's own `resolveTheme` on it | One pipeline, no second model to drift. Unknown or future keys survive a round trip |
| D4 | The creator writes its own formatted JSONC. Opening a hand-written file with comments shows "Saving rewrites this file; its comments are not kept", and the first save writes `<name>.jsonc.bak` | A JSONC round trip that keeps comments is a parser project of its own. Backup makes it safe |
| D5 | The preview renders **inside the modal** (mock toasts at real pixel size); a separate **"Test on screen"** button shows real Steam toasts with the draft | Inline: instant, side by side, no Steam state touched (R12). Real: final truth for placement, animation timing and Big Picture |
| D6 | "Test on screen" uses an **in-memory draft override** in `theme/active-theme.ts`, never the `theme` setting and never a file | Nothing persists if Steam crashes mid-test; cleared on close and by a 2-minute timeout |
| D7 | The banner's markup moves to a presentational `BannerCard` component (new area `frontend/ui/`) that both the banner surface and the creator render | The creator must not import a surface (layer rules); one markup, so the preview cannot drift from the real banner |
| D8 | Sound packs ship as **MP3 only** in `themes/sounds/<pack>/{chime,bloom,fanfare}.mp3` with a `themes/sounds/library.json` manifest. The zips and WAVs leave the plugin folder | 3.2 MB instead of 18 MB in every install; MP3 is already an allowed theme sound |
| D9 | Cue names: **Chime** (~0.95 s), **Bloom** (~1.4 s), **Fanfare** (~2.2 s). No ps4 / ps5 / platinum anywhere: file names, manifest, UI | R8 |
| D10 | The creator is **desktop only** in v1. In Big Picture the row is shown disabled with "Open Steam on the desktop to use the Theme Creator" | Editing colours and sliders with a controller in a 1280 px dialog is a separate design. The preview still has a Big Picture look toggle |
| D11 | New feature id **`creator`** (kill switch and error budget), though it writes nothing into Steam | An error boundary that counts failures and a way to switch the button off, like every other feature |
| D12 | Unsaved work is kept in SharedJSContext `localStorage` (`enhanced-notifications.creator.draft`) on every change; the next open offers "Restore unsaved theme" | A popout window can be closed by its own X, which the dialog cannot intercept |

### 3.2 Questions for the user (each has a recommendation; the plan assumes it)

| # | Question | Recommended |
| --- | --- | --- |
| Q1 | Sound pack display names (table in § 5.1): keep, or rename some? | As in § 5.1 |
| Q2 | Cue names Chime / Bloom / Fanfare? | Yes |
| Q3 | Ship MP3 only, and move the source zips and WAVs out of the plugin (to `assets-src/sfx/` at the workspace root, git-tracked or ignored)? | MP3 only; zips to `assets-src/sfx/`, **ignored** by git (15 MB of regenerable audio) |
| Q4 | Desktop only for v1 (D10)? | Yes |
| Q5 | Saving over a hand-written theme: rewrite with a `.bak` (D4), or refuse and force "Save as"? | Rewrite with `.bak` |
| Q6 | Should the creator also be able to **delete** a user theme? | Yes, with a confirm dialog, user themes only |
| Q7 | Add a bundled theme that uses the library out of the box (for example `steam_chimes.jsonc`: Steam's look, "Celtic Harp" sounds per tier)? | Yes, in phase 1; it proves the library works without the creator |

---

## 4. The user experience

### 4.1 Entry point (R1)

In `ThemeSection`, a new block **before** the Reload / Themes folder block (guardrail 18.5: a button that opens a popup
is its own block):

```
Theme
 ┌──────────────────────────────────────────────────────────┐
 │ Available themes                                         │
 │ Select a theme to choose the notification style          │
 │ [ ps5                                              ▾ ]   │
 └──────────────────────────────────────────────────────────┘
 ┌──────────────────────────────────────────────────────────┐
 │ Theme Creator                                  [ Open ]  │   ← new block
 │ Make a new theme or edit one of yours, with a live preview│
 └──────────────────────────────────────────────────────────┘
 ┌──────────────────────────────────────────────────────────┐
 │ Reload themes                                 [ Reload ] │
 │ Themes folder                                   [ Open ] │
 └──────────────────────────────────────────────────────────┘
```

`ButtonRow label="Theme Creator" description="Make a new theme or edit one of yours, with a live preview"
buttonLabel="Open"`. Disabled when `creator` is switched off, or in Big Picture (D10, the description then says why).
The panel does not import the creator: `index.tsx` injects `onOpenCreator` like `onPreview`.

After a save, the creator calls the same `refresh()` + `reloadTheme()` path as Reload, and if the saved theme is the
active one it reloads it; if the user pressed **Save and use**, it sets the `theme` setting to the new id.

### 4.2 The modal

Opened with `showDialog(<ThemeCreator …/>, { strTitle: "Theme Creator", popupWidth, popupHeight })`:
`popupWidth = clamp(1280, 1100, 0.92 × screen.availWidth)`, `popupHeight = clamp(860, 720, 0.9 × screen.availHeight)`
(spike S6 checks the window can be that size and whether it can be resized).

Three columns, fixed widths at 1280 px: navigation 200, editor 480, preview 560, gutters 40.

```
┌ Theme Creator ─────────────────────────────────────────────────────────────────────────────────────────────┐
│ my_theme.jsonc   ● Unsaved      from template: steam_tiers           [ Undo ][ Redo ]  [ Save ▾ ]  [ Close ]│
├──────────────┬──────────────────────────────────────────┬──────────────────────────────────────────────────┤
│ Start        │  CARD                                     │  PREVIEW                                         │
│ ──────────── │                                           │  [ Gallery | On screen ]   [ Desktop | Big Pic. ]│
│ Placement    │  Background                               │  Set  [ Achievement tiers (4)               ▾ ]  │
│ Card         │   ○ Steam's own   ● Colour   ○ Gradient   │                                                  │
│ Text         │   [■ #1F1F1F] [■ #0F0F0F] [+ stop]        │  ┌────────────────────────────────────┐  🔊      │
│ Icons        │   Angle ───────●──────── 90°              │  │ 🏆 ◆ First Steps            [Steam]│  Normal  │
│ Sound        │                                           │  │      Finish the tutorial            │          │
│ ──────────── │  Border                                   │  └────────────────────────────────────┘          │
│ Achievements │   Width ──●────────── 2 px                │  ┌────────────────────────────────────┐  🔊      │
│   Layout     │   Colour [■ #cd7f32]   Radius ──●── 8 px  │  │ 🏆 ◆ Night Owl              [Steam]│  Magic   │
│   Normal     │                                           │  └────────────────────────────────────┘          │
│   Magic      │  Glow                                     │  ┌ … Rare … ┐                          🔊        │
│   Rare       │   [■ #cd7f32]  Spread ─●─ 40  Pulse ─ 0ms │  ┌ … Exc. … ┐                          🔊        │
│   Exceptional│                                           │                                                  │
│ ──────────── │  Margin   ⛓ linked  ──●── 10 px            │  [ ▶ Replay ]  [ ⟲ Loop exit ]                  │
│ Code         │  Padding  ⛓ linked  ──●── 10 px            │  [ Test on screen ]                              │
│              │  Gap      icon→text ─●─ 10  rows ●─ 2      │  ⚠ 1 warning ▸                                   │
│              │  Steam watermark                  [toggle] │                                                  │
└──────────────┴──────────────────────────────────────────┴──────────────────────────────────────────────────┘
```

- **Navigation** is Steam's `SidebarNavigation` (the same component as Steam's own Settings dialog), pages listed below.
  The preview column sits outside it, so it stays visible on every page. If spike S7 shows `SidebarNavigation` cannot
  share its row with a third column, the navigation is a plain `Focusable` list styled like it.
- **Header**: the file name (editable in Save as), a dirty marker, where it came from (template / my theme / fresh),
  Undo / Redo (Ctrl+Z / Ctrl+Y, 100 steps), **Save ▾** (Save, Save as…, Save and use), Close.
- **Close with unsaved changes** opens a confirm: "Discard changes to my_theme?" (Discard / Keep editing). The draft is
  in `localStorage` anyway (D12).
- **Errors** never blank the modal: an error boundary around each column shows "This section failed" plus the error,
  and counts against `creator` (`reportError('creator', e)`).

### 4.3 The Start page (R3)

Shown first when the modal opens (and from the navigation's **Start**). Three cards, then lists:

```
  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
  │  From a template   │  │  Edit my themes    │  │  Start fresh       │
  │  A bundled theme,  │  │  Themes in your    │  │  Steam's own look; │
  │  saved as a copy   │  │  themes folder     │  │  change what you   │
  │                    │  │                    │  │  want              │
  └────────────────────┘  └────────────────────┘  └────────────────────┘

  Templates                         My themes
  ● steam_midnight   [Use]          ● my_theme          [Edit] [Duplicate] [Delete]
  ● steam_tiers      [Use]          ● night_owl (jsonc) [Edit] [Duplicate] [Delete]
  ● ps5              [Use]
  ● SteamStation     [Use]
  ● steam_chimes     [Use]          (Q7)
  ● theme_example    [Use]

  ↺ Restore unsaved theme "my_theme" (edited 12 min ago)    [Restore] [Forget]     (only when a draft is stored)
```

- **Template** → loads the bundled file, name suggestion `<template>_custom` (first free one), source `bundled`.
  The first save is always a Save as into the user folder.
- **Edit** → loads the user file; Save overwrites it (with the `.bak` of D4 if it had comments).
- **Fresh** → `{}` (every key unset = Steam's look), name suggestion `my_theme`.
- **Duplicate** → like Template, from a user theme.
- **Delete** (Q6) → confirm dialog, then the backend deletes `<name>.jsonc` and, after a second confirm line
  "Also delete its assets folder", `<name>/`. If it was the active theme, the setting goes back to Steam default.
- A theme the creator cannot parse opens in the **Code** page with the parse error, never silently as `{}`.
- If the user picks a name equal to a bundled theme's: "This hides the bundled theme <name> from the list" (user
  themes shadow bundled ones, `find_theme` in `backend/main.lua`).

### 4.4 Editor pages and their controls (R11)

Every control edits one JSON path of the draft. Every row has a **"Steam's own" state**: an unset key shows the value
Steam would use, greyed, and a ↺ IconButton on the row unsets the key. Rows use Steam's `Field` and the shared rows
(guardrail 18.6); sliders are `SliderRow`. Colours are a swatch button that opens `ColorPickerModal` (HSL converted
to hex by a pure helper) plus a hex `TextField` (`#rgb`, `#rrggbb`, `#rrggbbaa`, validated by the same regex as
`theme/theme.ts`).

**Placement** (`settings`)

| Key | Control | Range / options |
| --- | --- | --- |
| `settings.position` | Dropdown + a 16:9 corner map that highlights the corner | `POSITIONS` |
| `settings.animation` | "Same in and out" toggle; one dropdown, or two (In, Out) | `ANIMATIONS` |
| `settings.display_time_ms` | Slider | 1,000-60,000, step 500 |
| `settings.text_align` | Dropdown | `TEXT_ALIGNS` |
| `settings.hover` | Dropdown Steam's / None / Colour, + colour | `true` / `false` / `[true, "#hex"]` |

**Card** (`popup`, plus `font_family`)

| Key | Control | Range / options |
| --- | --- | --- |
| `popup.background` | Steam's / Colour / Gradient; 1-4 colour stops, add / remove | |
| `popup.gradient_angle` | Slider, shown with 2+ stops | 0-360 |
| `popup.border` | Width slider, colour, radius slider | 0-8 px, 0-32 px |
| `popup.glow` | Colour, spread slider, pulse slider (0 = steady) | 0-120, 0-5,000 ms |
| `popup.watermark` | Toggle | |
| `popup.margin`, `popup.padding` | "Linked" toggle: one slider, or four (top, right, bottom, left) | 0-64 px |
| `popup.gap` | Two sliders: icon to text, between rows. Hint under rows: "Keep it small: 10 px crops a three-row toast" (themes.md) | 0-32, 0-12 |
| `popup.scale`, `width`, `height` | Under "Achievement banner size" (banner only today) | 25-400 %, px |
| `font_family` | Dropdown of fonts Steam ships plus "Custom…" text | |

**Text** (`text.title`, `text.body`, `text.subtext`): per line, colour, size slider (50-200 %), style dropdown
(regular / bold / italic). A line under each names where it appears ("Title: the toast's first line, and the
achievement's name").

**Icons**: `game_icon` (toggle + radius slider 0-32), `header_icon` (toggle).

**Sound** (`sound`): three choices, **Steam's chime** (unset), **Mute** (`false`), **A sound**; with a sound, a
picker (§ 4.6) and a volume slider (0-100) with ▶ next to it.

**Achievements**: a toggle "Themed achievement banner" (adds or removes the `achievements` block; removing asks first
when the block has content). With it on:

- **Layout**: preset dropdown (`LAYOUT_PRESETS`) or "Custom": three dropdowns placing `achievement`, `system`,
  `rarity` (outer zones and the four text anchors, themes.md § achievements.layout). Block-level popup overrides
  (`achievements.padding` etc.) are here too, under "All tiers".
- **Normal / Magic / Rare / Exceptional** pages, one per tier. Each starts with a line "Inherits from: Normal ← All tiers ←
  Card", and each row shows **where its value comes from** (this tier, Normal, All tiers, Card, Steam's own) with a ↺
  that unsets it **on this tier only**. Rows: threshold (Magic and Rare only, slider 0.1-50 %, with the rule "Rare
  needs a lower threshold than Magic" as a warning), every `BANNER_KEYS` popup key, the three icon slots
  (Steam's / Hidden / Image + scale 25-300 % + ripple 0-5,000 ms), the tier sound (§ 4.6), and on Exceptional (the 100% toast) only the title
  and description texts.

**Code**: the generated JSONC in a monospace `TextField` (multi-line). Editable: on "Apply", it is parsed with
`parseJsonc`; a parse error is shown and nothing changes; a good parse replaces the draft (one undo step). "Copy"
copies it to the clipboard.

**Warnings strip** (under the preview): `resolveTheme(draft).warnings`, the same texts the "Theme problems" popup shows
today, plus creator-only checks (Rare threshold above Magic's, a row gap of 10 px or more, an asset over 8 MB). Clicking a warning
opens the page that owns the key.

### 4.5 The preview (R4, R5)

**Sets** (Dropdown "Set"):

| Set | Shows |
| --- | --- |
| Choose 4 notifications | Four dropdowns (`previewOptions()` minus Achievement), defaults: Download complete, Clip saved, Cloud sync failed, Low battery |
| 4 random notifications | Four distinct types, re-rolled with 🎲 (`pickPreview`, never the same type twice in a set) |
| Achievement tiers | Normal, Magic, Rare, Exceptional. Without an `achievements` block: four achievement toasts in the notification style, with a note "No banner: achievements look like every toast" |
| Mixed | Two notifications and two tiers (Normal, Rare) |
| Stack of one type | The same type four times, to judge stacking and the queue |

**Modes**:

- **Gallery**: the four toasts in a column at 1:1, each with its label (type or tier) and a 🔊 button. For comparing
  looks.
- **On screen**: a scaled 16:9 "screen" (the column's width, 560 × 315) with the toasts placed and stacked as Steam
  would: the theme's corner and margin, newest at the corner (`theme/placement.ts` `placeToast`, `banner/geometry.ts`
  `placeBanner`), drawn at the screen's scale. With the user's "Notifications queue" on, a note "Queue on: one at a
  time" and only the newest is drawn. For judging position and margin.
- **Desktop / Big Picture** look toggle: Desktop draws Steam's 283 × 70 desktop template; Big Picture draws its short
  40 px template and the banner in Steam's 300 × 80 frame (themes.md § Known limitations: no `scale` there).

**Controls**: **▶ Replay** remounts the toasts (entrance, then the glow pulse and icon ripples run); **⟲ Loop exit**
replays entrance, display time and exit in a loop with the real timings (`ANIMATION_MS`, `bannerTiming`); the mouse
hovers a toast to see `settings.hover`.

**What the toasts show**: sample text per type (Download complete: "Download complete" / the game's name / "Ready to
play"; Clip saved: "Clip saved" / "15 seconds"; and so on, a table in `creator/samples.ts`), the icon of a real game in
the library (the same appid `preview()` picks from `appAchievementProgressCache`, else a neutral bundled placeholder),
and for achievements that game's first achievement's icon, name and description when available, else "First Steps" /
"Finish the tutorial" with a placeholder icon.

**How a toast is drawn** (decided by spike S1/S2):

- **Notification toasts**: a mock of Steam's toast DOM using **Steam's own hashed classes** (from
  `resolveToastSelectors`, one class per part), inside a stage element marked `data-en-type`, plus the theme's CSS from
  `buildCss(style, sel, root)` and `buildAnimationCss(theme, sel, root)` scoped to the stage (§ 6.3). If S1 finds
  Steam's toast stylesheet is not in the modal's document, the stage also gets a small baseline stylesheet with the
  values measured live (template 70 px, padding 10, Steam's colours, fonts), written down in steam-components.md.
- If S2 finds Steam's own toast dispatcher (the component `setSteamToast` already receives) renders a synthetic
  notification outside a toast window, the stage renders **that** instead of the mock: Steam's real markup.
- **Achievement banners**: `BannerCard` (§ 6.4) with the draft's resolved achievement theme. The same markup as the
  real banner.

### 4.6 Sounds (R6, R7)

A **sound picker**, the same for the notification sound and each tier's sound, opened from the row's "Choose…" button
as a second dialog (or an inline drawer on the Sound page):

```
 Choose a sound                                          [ Library | This theme's files ]
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ Celtic Harp           Celtic concert strings     [▶ Chime][▶ Bloom][▶ Fanfare] │
 │ Bardic Harp           Bardic high flourish       [▶ Chime][▶ Bloom][▶ Fanfare] │
 │ 8-Bit Chiptune        NES-style chiptune         [▶ Chime][▶ Bloom][▶ Fanfare] │
 │ …                                                                          │
 └──────────────────────────────────────────────────────────────────────────┘
 Selected: Celtic Harp · Bloom (1.4 s)       Volume ──────●── 85    [▶]
                                  [ Use for this tier ]  [ Use this pack for every tier ]
```

- **Library**: the 17 packs from `library.json` (§ 5), each cue playable in place. Filter by category (Chiptune,
  Bells, Strings, Orchestral, World, Synth).
- **This theme's files**: `.mp3`, `.wav`, `.ogg` in the theme's own folder (backend `ListThemeAssets`, § 6.7), and
  **Import…** (spike S4: Steam's file dialog; if there is none, "Open the theme's folder" and a Rescan button).
- **"Use this pack for every tier"** sets the default mapping:

  | Tier | Cue | Volume |
  | --- | --- | --- |
  | Normal | Chime | 80 |
  | Magic | Chime | 90 |
  | Rare | Bloom | 90 |
  | Exceptional | Fanfare | 100 |

  and offers "Also as the notification sound" (Chime, 60). The volumes are a starting point the user changes.
- **Playback** goes through `audio()` (the plugin's one `AudioContext`); each clip is decoded once and cached for the
  modal's life. Playing a new clip stops the previous one. A click resumes a suspended context (a user gesture), as
  `preview()` does.
- **Steam's chime** (an unset sound): ▶ plays Steam's own toast sound if spike S5 finds its URL; otherwise the button
  is disabled with "Plays with Test on screen".
- Every 🔊 in the preview plays exactly what that toast would play, using the plugin's sound decision: the tier's clip,
  else the notification sound, else Steam's chime, `false` = nothing (`surfaces/sound/sound.ts`; the creator calls a pure
  `soundFor(draft, kind, tier)` in `theme/` that mirrors it, unit-tested against the same cases).

### 4.7 Test on screen (D5, D6)

"Test on screen" shows the current set as **real Steam toasts** with the draft, one after another, then the active
theme comes back:

1. The creator calls the injected `testDraft(draftRaw, assets, ids)`.
2. `active-theme.ts` `setDraftOverride(resolved)`: `activeTheme()`, `achievementTheme()`, `themeCss()` etc. now answer
   the draft; listeners fire (style, duration and queue surfaces react as on any theme change).
3. The preview surface fires the set: `preview(id)` for notifications, `previewTier(tier)` for tiers.
4. The override is cleared after the last toast's lifetime + 2 s, on modal close, on the next Test, or after 2 minutes,
   whichever is first. Clearing fires listeners again (durations restored to the active theme's).

Disabled while the `preview` feature is off, while Steam's toasts are off (`usePanelDisabled`), and in safe mode.

---

## 5. The sound library

### 5.1 Pack names (R8, Q1)

| Zip (`sequence_<x>.zip`) | Pack id (folder) | Display name | Category |
| --- | --- | --- | --- |
| `8bit_church` | `8bit_cathedral` | 8-Bit Cathedral | Chiptune |
| `8bit_gamelan` | `8bit_gamelan` | 8-Bit Gamelan | Chiptune |
| `8bit_glock` | `8bit_glockenspiel` | 8-Bit Glockenspiel | Chiptune |
| `retro_8bit` | `8bit_chiptune` | 8-Bit Chiptune | Chiptune |
| `retro_16bit` | `16bit_victory` | 16-Bit Victory | Chiptune |
| `bell_glock` | `steel_glockenspiel` | Steel Glockenspiel | Bells |
| `bell_tubular` | `tubular_bells` | Tubular Bells | Bells |
| `fantasy_musicbox` | `starlight_music_box` | Starlight Music Box | Bells |
| `harp` | `celtic_harp` | Celtic Harp | Strings |
| `harp_bardic` | `bardic_harp` | Bardic Harp | Strings |
| `guitar` | `acoustic_flageolet` | Acoustic Flageolet | Strings |
| `guitar_12string` | `twelve_string` | Twelve-String | Strings |
| `epic` | `cinematic` | Cinematic | Orchestral |
| `medieval` | `royal_courtyard` | Royal Courtyard | Orchestral |
| `afric_ancient` | `earthen_heritage` | Earthen Heritage | World |
| `afric_kora` | `kora_and_gourd` | Kora and Gourd | World |
| `robotic_quantum` | `quantum_core` | Quantum Core | Synth |

Cue files: `PS4/MP3/trophy_ps4_<x>.mp3` → `chime.mp3`, `PS5/MP3/trophy_ps5_<x>.mp3` → `bloom.mp3`,
`PLATINUM/MP3/trophy_platinum_<x>.mp3` → `fanfare.mp3`. The READMEs are not shipped (they say "PS4 Chime" etc.).

### 5.2 Files and manifest

```
enhanced-notifications/themes/sounds/
  library.json
  celtic_harp/chime.mp3
  celtic_harp/bloom.mp3
  celtic_harp/fanfare.mp3
  …
```

`library.json`:

```json
{
  "version": 1,
  "cues": [
    { "id": "chime",   "label": "Chime",   "seconds": 0.95 },
    { "id": "bloom",   "label": "Bloom",   "seconds": 1.4 },
    { "id": "fanfare", "label": "Fanfare", "seconds": 2.2 }
  ],
  "packs": [
    { "id": "celtic_harp", "label": "Celtic Harp", "category": "Strings", "description": "Celtic concert strings" }
  ]
}
```

`themes/sounds/` holds no `.json`/`.jsonc` at the folder root that `ListThemes` would list: `ListThemes` reads only the
top level of the themes folder, and `library.json` sits one level down. (Phase 1 adds a test that `ListThemes` never
lists `library`.)

### 5.3 Import script

`enhanced-notifications/tools/import-sfx.mjs` (Node, no dependencies; uses the system `tar`, which reads zips on
Windows 10+): reads the zips from a source folder, extracts only the three MP3s, writes them under the pack id, and
writes `library.json` from a table in the script (§ 5.1). Re-runnable; it refuses to overwrite a pack folder whose
files differ unless `--force`. The source zips then move to `assets-src/sfx/` (Q3).

### 5.4 How a theme uses a library sound

In the creator, a library pick is stored in the draft as the path it **will** have after saving,
`<theme>/<pack>_<cue>.mp3`, and a side table `pendingCopies` maps it to its source (`library:<pack>/<cue>.mp3`). The
preview loads the source; Save copies it (§ 6.6). A saved theme therefore never points into the bundled folder, and
stays valid when the plugin updates. A bundled theme (Q7) uses `sounds/<pack>/<cue>.mp3`, relative to the bundled
folder, which is its own folder.

### 5.5 Licensing

The packs are procedurally generated (the READMEs say "100% Procedural DSP Audio"), so they can ship in the public
repo. The Sony files listed in TASK.md § Considerations are not touched by this plan. The creator's template list
includes `ps5` and `SteamStation` as they are; saving a copy copies their assets into the user folder only, which never
ships.

---

## 6. Architecture

### 6.1 New and changed files

| File | Area | Pure | Job |
| --- | --- | --- | --- |
| `frontend/creator/index.tsx` | creator | no | `openThemeCreator(deps)`: sizes and opens the dialog |
| `frontend/creator/theme-creator.tsx` | creator | no | The modal: header, navigation, columns, error boundaries |
| `frontend/creator/pages/*.tsx` | creator | no | Start, Placement, Card, Text, Icons, Sound, Achievements (Layout, tiers), Code |
| `frontend/creator/preview/stage.tsx` | creator | no | Gallery and On screen modes, Replay, Loop |
| `frontend/creator/preview/mock-toast.tsx` | creator | no | Steam's toast DOM, with Steam's classes |
| `frontend/creator/sound-picker.tsx` | creator | no | Library and theme files, playback |
| `frontend/creator/controls.tsx` | creator | no | Colour swatch, linked edges, "inherited from" row, ↺ unset |
| `frontend/creator/samples.ts` | creator | yes | Sample texts per notification type and tier |
| `frontend/creator/preview-set.ts` | creator | yes | Which four toasts a set shows (uses `pickPreview`'s rule) |
| `frontend/theme/draft.ts` | theme | yes | `get/set/unset(raw, path)`, undo/redo history, `effectiveSource(raw, tier, key)` for "inherited from" |
| `frontend/theme/serialize.ts` | theme | yes | Draft → JSONC text: fixed key order (settings, popup, text, font_family, game_icon, header_icon, sound, achievements; tiers in `TIERS` order), 4-space indent, tuples on one line, a header comment |
| `frontend/theme/assets.ts` | theme | yes | Every asset path in a raw theme, the copy plan for a save (§ 6.6), path rewrite |
| `frontend/theme/sound-choice.ts` | theme | yes | `soundFor(theme, kind, tier)`: the sound decision for a preview toast |
| `frontend/theme/color.ts` | theme | yes | HSL(A) ↔ hex for `ColorPickerModal` |
| `frontend/theme/theme.ts` | theme | yes | `buildCss` and `buildAnimationCss` take an optional `root` (default `body[data-en-type]`, output unchanged) |
| `frontend/theme/active-theme.ts` | theme | no | `setDraftOverride(loaded \| null)` (§ 4.7) |
| `frontend/ui/banner-card.tsx` | ui (new) | no | The banner's markup, from `ThemedBanner` (D7) |
| `frontend/surfaces/banner/themed-toast.tsx` | surfaces/banner | no | Renders `BannerCard`; keeps queue, pin, hold, timing |
| `frontend/settings/settings-panel.tsx` | settings | no | The "Theme Creator" block; `onOpenCreator` prop |
| `frontend/rpc.ts` | rpc | no | `saveTheme`, `deleteTheme`, `listThemeAssets`, `soundLibrary` |
| `frontend/safety/features.ts` | safety | yes | Append `creator` to `FEATURE_IDS` |
| `frontend/index.tsx` | index | no | Wires `onOpenCreator` and `testDraft` |
| `backend/main.lua` | backend | — | `SaveTheme`, `DeleteTheme`, `ListThemeAssets`, `SoundLibrary` |
| `themes/sounds/**`, `tools/import-sfx.mjs` | — | — | § 5 |
| `tests/creator.test.ts`, `tests/draft.test.ts`, `tests/serialize.test.ts` | tests | — | § 10 |
| `tests/creator.mjs` | tests (live) | — | § 10 |

### 6.2 Layer rules (`tests/architecture.test.ts` `LAYER_RULES`)

Two new areas, three new rules; the allowlist stays empty:

```ts
[/^creator$/, /^(rpc|theme|banner|ui|settings|steam)$/], // the modal: theme pipeline, RPC, Steam's dialog (steam/modal.ts) and selectors
[/^ui$/, /^(theme|banner)$/],                               // presentational components over the pure theme and banner types
[/^surfaces\//, /^(steam|theme|banner|capture|settings|ui)$/], // (extends the existing rule with ui)
```

`creator` never imports a surface: the preview list, `preview()` and `previewTier()` reach it through `index.tsx`
(`deps`), like the settings panel. `settings` never imports `creator` (`onOpenCreator` is injected).
`ui/` is not pure (React) and is not listed as pure.

### 6.3 Scoping the preview CSS

`buildCss(s, sel, root = 'body[data-en-type]')` and `buildAnimationCss(theme, sel, root = …)`. The creator passes
`root = '[data-en-creator-stage]'`, and the stage's `<style>` lives inside the stage element, so nothing reaches the
modal's own controls or another window (guardrail 12: the CSS travels with the element, as `BANNER_CSS` does). A unit
test proves the default output is byte-identical to today's for every theme fixture in `tests/theme.test.ts`.

The animation CSS uses `--en-display-ms`; the stage sets it from the draft's display time (or 5,000 ms, Steam's
default) so Loop exit uses the real timings.

### 6.4 `BannerCard` (D7)

`BannerCard({ theme, tier, assets, title, description, imageUrl, phase, onClick, rootRef })` returns the markup that
`ThemedBanner` renders today after its `phase === 'waiting'` branch (the root `div.ea-banner` with its CSS variables,
`<style>{BANNER_CSS}</style>`, and the layout switch for `ps5` / custom / classic). `ThemedBanner` keeps every hook,
the queue, the pin, the hold and the timing, and passes its values in. A pure refactor: the achievement live suite
(`achievements-smoke`, `-tiers`, `-queue`, `-bigpicture`) must pass unchanged before anything else in the creator lands.

### 6.5 The draft

```ts
interface CreatorDraft {
    name: string;                         // file stem, [a-z0-9_-]{1,40}
    origin: { kind: 'fresh' } | { kind: 'template' | 'user'; id: string; dir: string; hadComments: boolean };
    raw: Record<string, unknown>;         // the theme JSON, edited by path
    pendingCopies: Record<string, AssetSource>;  // saved path → where it is now
}
type AssetSource = { kind: 'library'; pack: string; cue: string } | { kind: 'dir'; dir: string; path: string };
```

Every edit is `draft.ts` `set(raw, path, value)` / `unset(raw, path)` and returns a new object (history = an array of
snapshots, 100 deep). `useMemo(() => resolveTheme(raw), [raw])` gives the preview what the plugin would use (guardrail
17: resolving is pure work in render; asset loading is an effect keyed by the set of asset paths, debounced 250 ms,
cached by `(dir, path)`).

### 6.6 Saving

`SaveTheme` is called with the final text and a copy list, built by `theme/assets.ts` `copyPlan(draft)`:

1. Collect every asset path in `raw` (the same walk `resolveTheme` uses for `assetPaths`).
2. For each relative path: if it already lies under `<name>/` and the draft is a user theme with that name, keep it.
   Else it is copied to `<name>/<basename>` (a clash gets `-2`, `-3`) and the path in `raw` is rewritten. Library
   picks come from `pendingCopies`.
3. Absolute paths are kept as they are (the user chose them; themes.md allows them).
4. The text is `serialize(raw)`.

Backend `SaveTheme { name, text, overwrite, backup, copies: [{ from: 'bundled' | 'user' | 'library', path, to }] }`:

- `name` must match `^[A-Za-z0-9_-]{1,40}$`; the file is `<userDir>/<name>.jsonc`; nothing outside `<userDir>` is ever
  written (checked after joining, like `find_theme`'s `..` check).
- `overwrite: false` and the file exists → `{ error = "exists" }` (the creator asks, then calls again with `true`).
- `backup: true` → copy the old file to `<name>.jsonc.bak` first.
- Each copy: the source resolves inside the bundled themes folder, the user themes folder or `themes/sounds/`; its
  extension is in `MIME`; at most 8 MB; the target is inside `<userDir>/<name>/`. Anything else is refused with a
  message naming the file, and **nothing** is written (copies first into `<name>/`, then the theme file through a tmp
  file and `fs.rename`).
- Returns `{ id, path }`, `id` being what the `theme` setting stores (`list_themes` logic).

`DeleteTheme { name, assets }` deletes `<userDir>/<name>.jsonc` (or `.json`) and, with `assets`, `<userDir>/<name>/`;
refuses anything not in `<userDir>`.

### 6.7 Other RPCs

- `ListThemeAssets { dir }` → images and sounds under the theme's folder (one level of subfolders), each with size;
  `dir` must be the bundled or the user themes folder or a subfolder of them.
- `SoundLibrary {}` → `{ dir, manifest }` (the parsed `library.json`). The creator then loads cues with the existing
  `LoadAssets(dir, ['celtic_harp/chime.mp3'])`.

Each is registered in `backend/main.lua` (architecture test rule 4) and wrapped by `method()`.

### 6.8 Owners table (enhanced-notifications.md and `OWNERS`)

| Target | Owner |
| --- | --- |
| The user themes folder: writing and deleting theme files and their asset folders | `backend/main.lua` `SaveTheme` / `DeleteTheme` (called only from `creator/`) |
| The active theme's draft override | `theme/active-theme.ts` `setDraftOverride` (called only through `index.tsx` `testDraft`) |

No new Steam target. "Test on screen" uses the existing preview surface and `previewTier`.

### 6.9 Safety

- `creator` in `FEATURE_IDS`. Off: the button is disabled. Errors in the modal's boundaries call
  `reportError('creator', e)`; past the budget the button disables for the session.
- The override is bounded (§ 4.7) and cleared in a `finally` and on unmount.
- Safe mode: the button is disabled (nothing is hooked anyway).

---

## 7. Data flow

```
Settings panel ── onOpenCreator ──► creator/index.tsx ── showDialog ──► ThemeCreator (modal)
                                                                         │
     rpc.listThemes / loadTheme / soundLibrary / listThemeAssets ◄──────┤ Start page, pickers
                                                                         │
     draft.raw ──► resolveTheme (pure) ──► style, achievements, warnings │
                       │                                                 │
                       ├─► buildCss(root=stage) ─► <style> in the stage  │ Preview: mock toasts
                       ├─► BannerCard (ui/)                              │          banners
                       └─► soundFor ─► audio() ─► 🔊                    │          sounds
                                                                         │
     Save ─► copyPlan + serialize ─► rpc.saveTheme ─► backend writes ────┤
                                     └─► refresh list, reloadTheme (and set `theme` on "Save and use")
     Test on screen ─► index.tsx testDraft ─► setDraftOverride ─► preview()/previewTier() ─► real toasts ─► cleared
```

---

## 8. Spikes (before phase 4; live, read-only except where noted)

Each needs the Steam lock (Routine 0) when it opens dialogs or shows toasts. Each result goes into
steam-components.md (or knowledgebase.md for SDK facts) before the phase that depends on it.

| # | Question | How | Decides |
| --- | --- | --- | --- |
| S1 | Are Steam's toast CSS module rules present in a `showDialog` popout's document? | Open a ConfirmModal from SharedJSContext, check `document.styleSheets` of its window for a `DesktopToastTemplate` class | Whether the mock needs a baseline stylesheet |
| S2 | Can Steam's toast dispatcher (the component `toast-patch.ts` captures) render a synthetic notification inside an ordinary div? | Render it with `TestDownloadComplete`'s notification object captured from `NotificationStore` | Mock DOM vs Steam's real markup in the preview |
| S3 | Does `ColorPickerModal` open and return from inside a popout dialog (a modal over a modal)? | Open one from the probe dialog | Swatch → picker, or an inline HSL slider fallback |
| S4 | Is there a native file dialog reachable from SharedJSContext (`SteamClient.System.OpenFileDialog`, `SteamClient.Window`…)? | Enumerate `SteamClient.*` for `File` / `Dialog` methods; try one | "Import…" in the asset pickers, or folder + Rescan only |
| S5 | Where is Steam's toast chime (URL in `steamloopback.host` / `ChooseSound`'s result)? | Read `ChooseSound` on the store for a type | Whether "Steam's chime" plays in the preview |
| S6 | Max `popupWidth` / `popupHeight` for `showDialog`, and is the window resizable? | Open at 1280 × 860 and 1600 × 1000 | The modal's size rule |
| S7 | Can `SidebarNavigation` sit in a row with a third column, or does it take the whole dialog? | Render it in a flex row | Navigation component |
| S8 | `ListThemes` and the existing panel keep working with a `themes/sounds/` folder present | Offline: Lua test | Phase 1 safety |

---

## 9. Phases

Each phase ends green: `npm run check` clean, `npm test` all pass, `npm run build` clean, the live suite as stated,
committed. A phase's mechanical plan is written when it starts.

| Phase | Scope | Exit check |
| --- | --- | --- |
| **P1 Sound library** | `tools/import-sfx.mjs`; `themes/sounds/` (17 packs × 3 MP3, `library.json`); move the zips (Q3); `.gitignore`; optional `steam_chimes.jsonc` (Q7); themes.md § "Sound library"; `SoundLibrary` RPC | The import script prints 17 packs, 51 files; `npm test`; with `steam_chimes` active, the four tier previews play the four cues (by ear, the user) |
| **P2 Pure groundwork** | `theme/draft.ts`, `theme/serialize.ts`, `theme/assets.ts`, `theme/sound-choice.ts`, `theme/color.ts`, `buildCss`/`buildAnimationCss` `root` param, `creator/samples.ts`, `creator/preview-set.ts`; unit tests | `npm test`: new tests pass; `serialize(parseJsonc(x))` re-resolves to the same `resolveTheme` result for every bundled theme |
| **P3 BannerCard refactor** | `ui/banner-card.tsx`, `themed-toast.tsx` uses it, layer rule for `ui` | `npm test`; deploy; `npm run test:live` achievement checks pass as before (with the lock) |
| **P4 Backend writes** | `SaveTheme`, `DeleteTheme`, `ListThemeAssets`; Lua tests (name validation, path escape refused, copy refused for a disallowed type, atomic write) | Lua tests pass; architecture test (RPCs registered) |
| **P5 Spikes S1-S7** | § 8 | Findings written into the docs |
| **P6 Modal shell** | Entry button, `creator` feature id, modal at its size, Start page, header, Save / Save as / Save and use / Delete, unsaved guard, `localStorage` draft, Code page | Live: open, start from each source, save a copy of `ps5`, it loads in the dropdown and its assets resolve from the user folder |
| **P7 Editor pages** | Placement, Card, Text, Icons, Sound (without the library picker), Achievements Layout and tiers with "inherited from" | Live by hand: each control changes the saved file as expected; ↺ removes the key |
| **P8 Preview** | Stage (Gallery, On screen, Desktop / Big Picture look), sets, Replay, Loop exit, warnings strip, 🔊, sound picker with the library | Live: the four sets render; changing a colour updates the preview in under 100 ms; each 🔊 plays the expected clip |
| **P9 Test on screen** | `setDraftOverride`, `testDraft`, bounds | `tests/creator.mjs` passes; after a test the active theme's CSS and durations are back (compared before/after) |
| **P10 Docs** | ADR-0059, enhanced-notifications.md (layers, owners, feature id, Theme Creator section), themes.md (sound library, "made with the Theme Creator"), CHANGELOG, TASK | Docs review |

P1 and P2 can run in parallel; P3 before P8; P4 before P6.

---

## 10. Tests

**Unit (`npm test`)**

- `draft.test.ts`: set / unset create and prune empty objects; undo / redo; `effectiveSource` for every tier and
  `BANNER_KEYS` key (Normal → All tiers → Card → Steam's own).
- `serialize.test.ts`: for each bundled theme, `resolveTheme(parseJsonc(serialize(raw)))` deep-equals
  `resolveTheme(raw)`; key order; tuples on one line; unknown keys kept.
- `creator.test.ts`: `copyPlan` (template paths copied and rewritten, clashes numbered, absolute kept, library picks);
  `soundFor` matches `surfaces/sound/sound.ts` on the same cases; `preview-set` (four distinct, never Achievement in
  the notification sets); `color` round trips.
- `theme.test.ts` (extended): `buildCss` / `buildAnimationCss` with the default root produce exactly today's output.
- `architecture.test.ts`: the new `LAYER_RULES`; `creator` and `ui` never import a surface; `OWNERS` gains the two
  rows of § 6.8; the four new RPCs registered.

**Lua (`tests/test_backend.lua`, new for this plugin, in the style of steam-cartridges')**: `SaveTheme` refuses
`../x`, `a/b`, an empty or 41-character name, a `.exe` copy, a 9 MB copy, a source outside the three roots; writes
atomically; `overwrite` and `backup`; `DeleteTheme` refuses outside `<userDir>`; `ListThemes` never lists
`sounds/library.json`.

**Live (`tests/creator.mjs`, added to `tests/run-live.mjs`)**: opens the creator through the exported
`openThemeCreator`, checks the Start page lists the bundled themes, saves a copy of `steam_tiers` as
`__creator_test`, checks `ListThemes` has it and `LoadAssets` resolves its rarity icons from the user folder, runs
Test on screen with one notification and checks `themeCss()` before and after are equal, deletes `__creator_test`.
Prints `PASS creator`.

---

## 11. Guardrails this touches

| Guardrail | How the design keeps it |
| --- | --- |
| [2 (hot paths O(1))](../plugins.md#2-zero-expensive-operations-in-hot-prototype-methods-o1-strictly-enforced) | The override is a pointer swap; toast-time reads stay cached values |
| [12 (popup hooks)](../plugins.md#12-popup-hooks-do-not-see-every-window) | The preview's CSS is a `<style>` inside the stage element, never injected by a window hook |
| [15 (never weaken a check)](../plugins.md#15-never-weaken-a-verification-check-to-match-new-behaviour) | P3's refactor must pass the achievement live checks unchanged |
| [17 (a render never starts work)](../plugins.md#17-a-render-never-starts-work-a-refresh-never-leaves-its-own-components) | RPCs, asset loads and decoding run in effects and click handlers; render only resolves and builds CSS (pure) |
| [18 (panel layout)](../plugins.md#18-settings-panel-layout-reference-enhanced-notifications) | The entry button is its own block; the modal's editor pages use `Field`, the shared rows and `Blocks` (18.6); the preview stage is a canvas, not settings rows |
| Architecture test | Two new areas with explicit rules, empty allowlist kept |

---

## 12. Risks

| Risk | Mitigation |
| --- | --- |
| The mock toast drifts from Steam's real toast after a Steam update | S2 (Steam's own markup) if possible; else Steam's own classes from `resolveToastSelectors`; and Test on screen as the truth |
| A big dialog is slow: every slider tick resolves the theme and rebuilds CSS | Both are pure and small (< 1 ms measured target); debounce only asset loads; measure in P8 |
| The override leaks (the user's real toasts get the draft) | Bounded lifetime, cleared on unmount and in `finally`, live test compares `themeCss()` before and after |
| A save half-written | Copies first, theme file last through tmp + rename; any refusal writes nothing |
| `.bak` files pile up | One `.bak` per theme, overwritten each time |
| Users expect comments kept | D4 warning before the first save; the Code page shows exactly what will be written |
| Name clash with a bundled theme hides it | Warning on Save as (§ 4.3) |

---

## 13. Do not touch / banned (for every phase plan)

- Do not change any surface's behaviour, `steam/*`, the notification hook, the banner queue or the toast patch,
  except P3's markup move (no logic change) and P9's override reader.
- Do not edit the bundled themes (`ps5.jsonc`, `SteamStation.json`, `steam_tiers.json`, `steam_midnight.json`,
  `theme_example.jsonc`) or anything under `themes/PlayStation/`, `themes/SteamStation/`, `themes/assets/`.
- Banned: deploy or Steam restart outside the Steam lock; SharedJSContext reload; edits to Millennium's `config.json`;
  `npm install` / upgrades; `git push --force`; `--no-verify`; AI attribution in commits (AGENTS.md Routine 6).
- Failure rule: a failing command at most twice, then stop and record it in TASK.md § Active failures.
