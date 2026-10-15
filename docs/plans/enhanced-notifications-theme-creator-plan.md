# enhanced-notifications: Theme Creator (design and phased plan)

**Status (2026-10-14):** **built, P1-P10** (§ 14, ADR-0069), with the user's addition of a Desktop / Big Picture mode
(ADR-0068: a theme's `bigpicture` block). Live: `tests/creator.mjs` 15/15, the whole live suite green on Steam 1791918634.
Every item built (§ 14, second pass); left: the user's look at it.
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
| R7 | The AI-generated sound packs (formerly `enhanced-notifications/themes/SteamStation/custom/sfx/`; removed from the tree with the third-party material 2026-10-14, restore with `git checkout 6ece444 -- enhanced-notifications/themes/SteamStation/custom/sfx`) are offered in the creator |
| R8 | Those sounds are **not named ps4 / ps5 / platinum** (proprietary names, only ever a reference) |
| R13 | Layout: **navigation on the left, preview in the middle, editor on the right**; the preview stays visible on every page |
| R14 | With a sound pack, the user **picks the cue for each tier** (and the notification sound): Subtle, Distinct or Grand |
| R15 | Bundled themes are **templates only**: "Save as", never saved over. Only the user's own themes are edited, and deleted |
| R16 | The library ships as **WAV**; a user's own sounds may be **MP3 or WAV** |

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

**The sound packs** (`themes/SteamStation/custom/sfx/` at `6ece444`, 17 zips, all tracked; P1 restores them from that commit into their new home): every zip has the same shape,
three cues, each as WAV (48 kHz, 16-bit stereo) and MP3, plus a README:

| Cue in the zip | Length | Character (README) |
| --- | --- | --- |
| `PS4/…/trophy_ps4_<mood>` | ~0.95 s | short, punchy chime |
| `PS5/…/trophy_ps5_<mood>` | ~1.40 s | warm swell, open chord bloom |
| `PLATINUM/…/trophy_platinum_<mood>` | ~2.20 s | multi-stage fanfare |

MP3 per pack ≈ 190 KB (all 17: ≈ 3.2 MB). WAV per pack ≈ 875 KB (all 17: ≈ 15 MB). The library ships the WAVs
(R16); the largest file (a Grand cue, 432 KB) is far under the backend's 8 MB asset cap, and about 580 KB as the
base64 data URL `LoadAssets` returns.

**The trap this design avoids:** a theme's relative paths resolve against **its own folder** (themes.md § File paths).
A bundled template such as `SteamStation.jsonc` points at `SteamStation/assets/trophy_bronze.svg` inside the bundled folder. Saved as-is into
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
| D4 | The creator writes its own formatted JSONC. **Save** exists only for the user's own themes; a bundled theme (a template) only has **Save as** (R15). Opening a user theme with comments shows "Saving rewrites this file; its comments are not kept", and the first save writes `<name>.jsonc.bak` | A JSONC round trip that keeps comments is a parser project of its own. Backup makes it safe |
| D5 | The preview renders **inside the modal** (mock toasts at real pixel size); a separate **"Test on screen"** button shows real Steam toasts with the draft | Inline: instant, side by side, no Steam state touched (R12). Real: final truth for placement, animation timing and Big Picture |
| D6 | "Test on screen" loads the draft **in memory** through `theme/active-theme.ts` `loadDraft` (the same load path as a theme file), never the `theme` setting and never a file | Nothing persists if Steam crashes mid-test; cleared on close and by a 2-minute timeout |
| D7 | The banner's markup moves to a presentational `BannerCard` component in `surfaces/banner/`, which `index.tsx` injects into the creator | The settings panel never imports a surface; one markup, so the preview cannot drift from the real banner; no new area (§ 6.0) |
| D8 | Sound packs ship as **WAV** in `themes/sounds/<pack>/{subtle,distinct,grand}.wav` with a `themes/sounds/library.json` manifest. The source zips (and their MP3s) leave the plugin folder | The user's choice (R16): lossless, ≈ 15 MB. A user's own sounds stay `.mp3` or `.wav` (`.ogg` too, already allowed by themes.md, not removed) |
| D9 | Cue names: **Subtle** (~0.95 s), **Distinct** (~1.4 s), **Grand** (~2.2 s). No ps4 / ps5 / platinum anywhere: file names, manifest, UI | R8; the user's names |
| D10 | Desktop only: Millennium's plugin settings panel exists only in desktop mode, so the creator needs no Big Picture handling | The preview still has a Big Picture **look** toggle, because toasts do show in Big Picture |
| D11 | **No new layer, area or feature id.** The creator lives in the Settings panel layer (`frontend/settings/creator/`), its theme-editing logic in the pure domain (`theme/draft.ts`), and everything it needs from surfaces or start-up is injected by `index.tsx` (§ 6.0) | enhanced-notifications.md: feature ids are for writes into Steam, and the creator writes none; the existing layers already have a home for every piece |
| D12 | Unsaved work is kept in SharedJSContext `localStorage` (`enhanced-notifications.creator.draft`) on every change; the next open offers "Restore unsaved theme" | A popout window can be closed by its own X, which the dialog cannot intercept |

### 3.2 The user's answers (2026-10-04)

| # | Question | Answer |
| --- | --- | --- |
| Q1 | Sound pack display names (§ 5.1) | Kept as proposed |
| Q2 | Cue names | **Subtle / Distinct / Grand** (not Chime / Bloom / Fanfare) |
| Q3 | Library format | **WAV**. A user's own sounds may be MP3 or WAV |
| Q4 | Big Picture | Not needed: Millennium plugins (their settings) are desktop only |
| Q5 | Saving over a theme | Only the user's own themes are edited and saved over; bundled themes are templates, **Save as** only |
| Q6 | Delete | Yes, user-created themes only |
| Q7 | A bundled theme using the library | No: **the user makes the bundled template themes**. The creator lists whatever bundled themes exist |
| Q8 | Column order | **Navigation left, preview middle, editor right** |
| Q9 | Sound pack assignment | Not one fixed mapping: the user **picks Subtle, Distinct or Grand for each tier** (and the notification sound) |

Still open, decided by the plan unless the user objects: the zips move out of the plugin to `assets-src/sfx/` at the
workspace root, ignored by git (regenerable, and the WAVs are already extracted into `themes/sounds/`).

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
buttonLabel="Open"`. The creator is part of the settings panel (`settings/creator/`, same area), so the panel opens it
directly; what the creator needs from surfaces comes in one injected `creator` deps object (§ 6.1).

After a save, the creator calls the same `refresh()` + `reloadTheme()` path as Reload, and if the saved theme is the
active one it reloads it; if the user pressed **Save and use**, it sets the `theme` setting to the new id.

### 4.2 The modal

Opened with `showDialog(<ThemeCreator …/>, { strTitle: "Theme Creator", popupWidth, popupHeight })`:
`popupWidth = clamp(1280, 1100, 0.92 × screen.availWidth)`, `popupHeight = clamp(860, 720, 0.9 × screen.availHeight)`
(spike S6 checks the window can be that size and whether it can be resized).

Three columns (R13): **navigation 200 (left), preview 560 (middle), editor 480 (right)**, then one **action row**
across the bottom. The preview is between the page list and the page it shows, so what is edited and its result sit
side by side, and it never changes when the page changes. Each column is its own panel and follows the settings
panel's rules (§ 4.3): the editor and the preview are each a thin column of `PanelSection`s and `Blocks`, exactly like
the plugin's settings panel.

```
┌ Theme Creator: my_theme ────────────────────────────────────────────────────────────────────────────────────┐
├──────────────┬──────────────────────────────────────────────────┬──────────────────────────────────────────┤
│ Start        │ ┌──────────────── stage (sticky) ──────────────┐ │ CARD                                     │
│ ──────────── │ │ ┌──────────────────────────────────┐         │ │ ┌──────────────────────────────────────┐ │
│ Placement    │ │ │ 🏆 ◆ First Steps          [Steam]│         │ │ │ Background                      [↺]  │ │
│ Card       ◀ │ │ │      Finish the tutorial          │         │ │ │ Set by this theme                    │ │
│ Text         │ │ └──────────────────────────────────┘         │ │ │ [ Gradient                       ▾ ] │ │
│ Icons        │ │ ┌ … Magic … ┐                                │ │ │ Colour 1                     [■][✕]  │ │
│ Sound        │ │ ┌ … Rare … ┐                                 │ │ │ #1F1F1F                              │ │
│ ──────────── │ │ ┌ … Exceptional … ┐                          │ │ │ Colour 2                     [■][✕]  │ │
│ Achievements │ └───────────────────────────────────────────────┘ │ │ #0F0F0F                              │ │
│   Layout     │                                                   │ │ Add a colour                  [Add]  │ │
│   Normal     │ PREVIEW                                           │ │ Angle                          90°   │ │
│   Magic      │ ┌──────────────────────────────────────────────┐ │ │ ─────────────●───────────────        │ │
│   Rare       │ │ Preview set                                  │ │ └──────────────────────────────────────┘ │
│   Exceptional│ │ What the stage shows                         │ │                 22 px                    │
│ ──────────── │ │ [ Achievement tiers (4)                  ▾ ] │ │ ┌──────────────────────────────────────┐ │
│ Code         │ └──────────────────────────────────────────────┘ │ │ Border                          [↺]  │ │
│              │                   22 px                          │ │ From the template                    │ │
│              │ ┌──────────────────────────────────────────────┐ │ │ Width                           2 px │ │
│              │ │ On screen                          [toggle]  │ │ │ ──●─────────────────────────         │ │
│              │ │ Big Picture look                   [toggle]  │ │ │ Colour                       [■]     │ │
│              │ └──────────────────────────────────────────────┘ │ │ #cd7f32                              │ │
│              │   … Sounds, Replay, Test on screen (§ 4.6) …     │ │   … (scrolls)                        │ │
├──────────────┴──────────────────────────────────────────────────┴──────────────────────────────────────────┤
│ ● Unsaved changes                                                  [↶] [↷]  [ Save as… ]  [ Save ]  [ Close ]│
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Navigation** is a `Focusable` page list on the left, styled with the classes of Steam's own Settings sidebar
  (resolved in the same start-up scan as the toast selectors, `steam/selectors.ts`, and injected; spike S7). Steam's
  `SidebarNavigation` is not used as-is: it renders the list and the page content as one unit, so nothing can sit
  between them, and the preview would remount (and replay) on every page change. The selected page is creator state;
  the preview is a sibling that never remounts.
- **Preview** (middle): the **stage** (the toasts, § 4.5) is `position: sticky` at the top of the column; the preview's
  own rows under it scroll. The stage is a canvas, not settings rows: it draws Steam's toasts at Steam's sizes.
- **Editor** (right) scrolls on its own.
- **Action row** (guardrail 18.6: a popup's own buttons are its last `ActionRow`, status left, buttons right), across
  all three columns:
  - Status message, in `ActionRow`'s colours: "● Unsaved changes", "Saving...", "✓ Saved as my_theme", or an error.
  - `IconButton`s ↶ / ↷ (Undo / Redo, also Ctrl+Z / Ctrl+Y, 100 steps).
  - **Save as…**: always. It opens a small popup (§ 4.3 rules): `FullWidthRows` "Name" (`TextField`), a toggle row
    "Use it now" (sets the `theme` setting after saving), the warning row "This hides the bundled theme <name>" when
    the name is a bundled theme's, and its own `ActionRow` (Cancel, Save).
  - **Save**: only for a user theme (R15). Not shown for a template or a fresh theme until their first Save as.
  - **Close**: with unsaved changes it opens a confirm, "Discard changes to my_theme?" (Discard / Keep editing). The
    draft is in `localStorage` anyway (D12).
- **Errors** never blank the modal: an error boundary around each column shows "This section failed" plus the error,
  and is logged (no feature id, § 6.9).

### 4.3 Every column follows the settings panel's rules (guardrail 18)

The plugin's settings panel is one thin column; the creator is three of them side by side. Guardrail 18
([plugins.md](../plugins.md#18-settings-panel-layout-reference-enhanced-notifications)) applies to **each column on its
own**, and to every popup the creator opens (Save as, the colour picker, the sound picker, Delete):

| Guardrail 18 | In the creator |
| --- | --- |
| 18.1 Steam's components | `PanelSection`, `Field`, `Toggle`, `DialogButton`, `Dropdown`, `TextField`, `SliderField`, through the shared rows of `settings/rows.tsx`. No hand-made rows, notes or checkboxes |
| 18.2 Two columns at most | A row is label + description on the left, and on the right **one** toggle or **one or two small** buttons. Never a slider and a button, never two sliders, never a colour and a slider in one row |
| 18.3 A control that needs room gets the full row | Every `Dropdown` and `TextField` is `FullWidthRows` (label, description, then the control across the column). The Code page's text area too |
| 18.4 Spacing is a system | Blocks are `BLOCK_GAP` (22 px) apart, set only by `<Blocks>`; rows inside a block touch; `ItemRow trailing` cancels Steam's own trailing space; controls inside a custom card are `CONTROL_GAP` (8 px) apart on `CARD_BACKGROUND`. No margin on a single row, anywhere |
| 18.5 Group by meaning | **One block per theme key** (or per key group: border width, colour and radius are one block). A button that opens a popup is its own block. "Add a colour" is a `ButtonRow` |
| 18.6 Popups follow the same rules | Each popup is `PanelSection` + `Blocks`, ending in an `ActionRow`. The modal itself ends in one (§ 4.2) |
| 18.7 No empty-state rows, one icon-button size | A block with nothing to show is left out of `<Blocks>` (warnings, the Restore row, tier sounds without a banner). ↺, ✕, ▶, ↶, ↷ and the colour swatch are all `IconButton`, one size |
| 18.8 No diagnostics | No error counters or kill switches. Theme warnings are not diagnostics: they are what the existing "Theme problems" popup shows, about the user's own file (§ 4.5) |

Two patterns, used for every key so the pages read the same:

- **A key with a few values** (position, animation, text alignment, hover, watermark, header icon, the sound mode, a
  tier icon's source): one `FullWidthRows` `Dropdown` whose **first option is "Steam's own"** (or "From Normal" on a
  tier page), exactly as the panel's theme dropdown starts with "Steam default". Choosing it unsets the key. No ↺.
- **A key with a composite value** (colours, sizes, edges, text styles, icon scale and ripple): a block that starts
  with a **header row**: label = the key's name, description = where its value comes from ("Set by this theme",
  "Steam's own", "From Normal", "From All tiers", "From the card"), and on the right one `IconButton` ↺ that unsets it
  (only while the key is set here). While unset, the header row's button is **Customize** instead: it writes the value
  shown (Steam's or the inherited one) to this key, and the block's control rows appear under it. An unset block is one
  row.

Shared rows the creator needs, all in `settings/rows.tsx` so the panel and the creator look the same:

- `FullWidthRows`, `ActionRow`, `IconButton`, `BUTTON_STYLE`: copied from steam-cartridges'
  `frontend/settings/components.tsx` unchanged (guardrail 18 names that file as the other copy).
- `ToggleRow` and `SliderRow` read a setting key today. They get **controlled** twins (`value`, `onChange`, and for
  the slider `min`, `max`, `step`, `suffix`), and the key-bound ones become thin wrappers over the twins, so there is
  one look for both.
- `ColourRow` (in `settings/creator/controls.tsx`, built on `Field`): label, description = the hex value, on the right
  the swatch `IconButton` (filled with the colour) and, where the colour can be removed (a gradient stop), ✕. The
  swatch opens `ColorPickerModal`; the hex is typed in that popup's own `FullWidthRows` `TextField`, never in the row.

Column widths and inner padding match the plugin's settings panel: spike S9 measures the panel's horizontal padding
and row heights live, and each column uses the same. Columns are divided by a 1 px line in Steam's separator colour,
not by extra gutters.

### 4.4 The Start page (R3)

Shown first when the modal opens (and from the navigation's **Start**), in the editor column. **Focusing or hovering
a row previews that theme on the stage** (loaded read-only, 300 ms after focus settles), so the user sees a template
before picking it.

```
 ┌──────────────────────────────────────┐   only when a draft is stored
 │ Unsaved theme: my_theme              │
 │ Edited 12 min ago  [Restore][Forget] │
 └──────────────────────────────────────┘
 NEW
 ┌──────────────────────────────────────┐
 │ Start fresh                 [Start]  │
 │ Steam's own look; change what you    │
 │ want                                 │
 └──────────────────────────────────────┘
 TEMPLATES
 ┌──────────────────────────────────────┐
 │ steam_midnight                [Use]  │
 │ Bundled, saved as a copy             │
 │ steam_tiers                   [Use]  │
 │ Bundled, saved as a copy             │
 └──────────────────────────────────────┘
 MY THEMES
 ┌──────────────────────────────────────┐
 │ my_theme               [Edit] [🗑]   │
 │ Yours, edited 2 Oct                  │
 │ night_owl (jsonc)      [Edit] [🗑]   │
 └──────────────────────────────────────┘
```

Each list is one block (its rows read as one card); each row is a `ButtonRow` (Templates) or a `Field` with two small
buttons (My themes: Edit and an `IconButton` 🗑), never three.

- **Use** (template) → loads the bundled file, name suggestion `<template>_custom` (first free one), origin
  `template`. It is never saved over: Save as only (R15, D4). Templates have no Edit and no Delete. Templates are every
  bundled theme `ListThemes` returns; the user makes the shipped ones (Q7).
- **Edit** → user themes only; loads the file; Save overwrites it (with the `.bak` of D4 if it had comments). To copy
  one of your own themes, Edit it and Save as (there is no separate Duplicate button: it would be a third button).
- **Start fresh** → `{}` (every key unset = Steam's look), name suggestion `my_theme`; Save as only until first saved.
- **🗑** (Q6) → user themes only. Confirm popup with a toggle row "Also delete its assets folder" (`<name>/`, on by
  default when the creator made it). If it was the active theme, the setting goes back to Steam default. The backend
  refuses a bundled theme whatever the frontend sends (§ 6.6).
- A theme the creator cannot parse opens in the **Code** page with the parse error, never silently as `{}`.

### 4.5 Editor pages and their controls (R11)

Every control edits one JSON path of the draft, through one of the two patterns of § 4.3. "Rows" below lists a
block's rows top to bottom; "header" is the composite-key header row (↺ / Customize). Sliders are the controlled
`SliderRow` (label and value above the track).

**Placement** (`settings`)

| Key | Rows | Range / options |
| --- | --- | --- |
| `settings.position` | `FullWidthRows` Dropdown (Steam's own, then `POSITIONS`). The stage's On screen mode shows the corner | `POSITIONS` |
| `settings.animation` | Toggle row "Same in and out"; then one `FullWidthRows` Dropdown, or two (In, Out) | Steam's own, `ANIMATIONS` |
| `settings.display_time_ms` | Header; slider | 1,000-60,000, step 500 |
| `settings.text_align` | `FullWidthRows` Dropdown | Steam's own (left), `TEXT_ALIGNS` |
| `settings.hover` | `FullWidthRows` Dropdown (Steam's own / None / Colour); with Colour, a `ColourRow` | `true` / `false` / `[true, "#hex"]` |

**Card** (`popup`, plus `font_family`), one `PanelSection` "Card":

| Key | Rows | Range / options |
| --- | --- | --- |
| `popup.background` | Header; `FullWidthRows` Dropdown (Colour / Gradient); one `ColourRow` per stop (✕ on each with 2+ stops); `ButtonRow` "Add a colour" (up to 4); with 2+ stops a slider "Angle" (`popup.gradient_angle`, 0-360) | |
| `popup.border` | Header; slider Width (0-8 px); `ColourRow`; slider Radius (0-32 px) | |
| `popup.glow` | Header; `ColourRow`; slider Spread (0-120); slider Pulse (0-5,000 ms, 0 = steady) | |
| `popup.watermark` | `FullWidthRows` Dropdown (Steam's own / Shown / Hidden) | |
| `popup.margin`, `popup.padding` | One block each: header; toggle row "Same on every side"; one slider "All sides", or four (Top, Right, Bottom, Left) | 0-64 px |
| `popup.gap` | Header (description: "Keep Between rows small: 10 px crops a three-row toast", themes.md); slider Icon to text (0-32); slider Between rows (0-12) | |
| `font_family` | `FullWidthRows` Dropdown (Steam's own, fonts Steam ships, Custom…); with Custom, a `FullWidthRows` `TextField` | |

A second `PanelSection` "Achievement banner size" (banner only today): `popup.scale`, `width`, `height`, each a
header and slider(s) (25-400 %, px).

**Text**: one `PanelSection`, one block per line (`text.title`, `text.body`, `text.subtext`): header (description
names where the line appears: "The toast's first line, and the achievement's name"); `ColourRow`; slider Size
(50-200 %); `FullWidthRows` Dropdown Style (regular / bold / italic).

**Icons**: block `game_icon`: `FullWidthRows` Dropdown (Steam's own / Shown / Hidden); when Shown, header and slider
Corner radius (0-32). Block `header_icon`: `FullWidthRows` Dropdown (Steam's own / Shown / Hidden).

**Sound** (`sound`), one `PanelSection` "Notification sound":

- Block: `FullWidthRows` Dropdown (Steam's chime / Mute / A sound).
- With A sound, block: a `Field` row, label = the sound ("Celtic Harp · Subtle"), description = its length, right:
  `IconButton` ▶; then slider Volume (0-100).
- With A sound, block: `ButtonRow` "Choose a sound" [Choose…] (opens the single sound picker, § 4.7; its own block,
  18.5).

Under it, the `PanelSection` "Sound pack" (§ 4.7), which sets the notification sound and every tier's sound from one
pack.

**Achievements** (Layout page): block: toggle row "Themed achievement banner" (adds or removes the `achievements`
block; turning it off asks first when the block has content). With it on:

- Block: `FullWidthRows` Dropdown Layout (`LAYOUT_PRESETS`, Custom). With Custom, one block of three `FullWidthRows`
  Dropdowns placing `achievement`, `system`, `rarity` (outer zones and the four text anchors, themes.md §
  achievements.layout).
- `PanelSection` "All tiers": the block-level popup overrides (`achievements.padding` etc.), each a block like on the
  Card page, with "From the card" as the unset source.

**Normal / Magic / Rare / Exceptional** pages, one per tier, each a stack of `PanelSection`s. The first row of the page
is a `Field` "Inherits from: Normal ← All tiers ← Card" (no control). Every header row's description names where its
value comes from, and ↺ unsets it **on this tier only**.

| Section | Blocks |
| --- | --- |
| Rule (Magic, Rare) | Header; slider Threshold (0.1-50 %). "Rare needs a lower threshold than Magic" is a theme warning (§ 4.6) |
| Card | One block per `BANNER_KEYS` key, as on the Card page |
| Icons | One block per slot (`achievement`, `system`, `rarity`): `FullWidthRows` Dropdown source (From Normal / Steam's / Hidden / Image); with Image, a `Field` with the file name and a separate block `ButtonRow` "Choose an image" [Choose…]; slider Scale (25-300 %); slider Ripple (0-5,000 ms) |
| Sound | As the Sound page's first three blocks, with "From Normal" (or "Notification sound") as the first dropdown option |
| Text (Exceptional only) | `FullWidthRows` `TextField` Title; `FullWidthRows` `TextField` Description |

**Code**: one block: `FullWidthRows` `TextField` (multi-line, monospace) with the generated JSONC. Then one block of
two `ButtonRow`s: "Apply changes" [Apply] (parses with `parseJsonc`; a parse error goes to the action row's status
and nothing changes; a good parse replaces the draft, one undo step) and "Copy to clipboard" [Copy].

### 4.6 The preview (R4, R5)

**Sets** (`FullWidthRows` Dropdown "Preview set"):

| Set | Shows |
| --- | --- |
| Choose 4 notifications | The four types picked in a small popup (`ButtonRow` "Choose notifications" [Choose…], its own block): four `FullWidthRows` Dropdowns (`previewOptions()` minus Achievement) and an `ActionRow`. Defaults: Download complete, Clip saved, Cloud sync failed, Low battery |
| 4 random notifications | Four distinct types; `ButtonRow` "New random set" [Shuffle] (`pickPreview`, never the same type twice in a set) |
| Achievement tiers | Normal, Magic, Rare, Exceptional. Without an `achievements` block: four achievement toasts in the notification style, and the set's description says "No banner: achievements look like every toast" |
| Mixed | Two notifications and two tiers (Normal, Rare) |
| Stack of one type | The same type four times, to judge stacking and the queue |

**The preview column, top to bottom:**

1. **Stage** (sticky; a canvas, § 4.2).
   - **Gallery** (default): the four toasts in a column at 1:1, for comparing looks.
   - **On screen**: a scaled 16:9 "screen" (560 × 315) with the toasts placed and stacked as Steam would: the theme's
     corner and margin, newest at the corner (`theme/placement.ts` `placeToast`, `banner/geometry.ts` `placeBanner`),
     drawn at the screen's scale. With the user's "Notifications queue" on, only the newest is drawn.
   - **Big Picture look**: Steam's short 40 px template, and the banner in Steam's 300 × 80 frame (themes.md § Known
     limitations: no `scale` there). Otherwise Steam's 283 × 70 desktop template.
   - The mouse hovers a toast to see `settings.hover`.
2. `PanelSection` **Preview**: block "Preview set" (the dropdown, plus the set's own Choose / Shuffle block when it has
   one); block of two toggle rows "On screen" and "Big Picture look" (each with its description).
3. `PanelSection` **Sounds**: one block, **one row per toast on the stage**: label = the type or tier, description =
   what it plays ("Celtic Harp · Grand, 100 %", "Steam's chime", "Muted"), right: `IconButton` ▶. It plays exactly
   what that toast would (§ 4.7).
4. `PanelSection` **Animation**: block of a `ButtonRow` "Replay" [Replay] (remounts the toasts: entrance, then the
   glow pulse and icon ripples) and a toggle row "Loop entrance and exit" (with the real timings, `ANIMATION_MS`,
   `bannerTiming`).
5. Block: `ButtonRow` "Test on screen" [Test], description "Shows this set as real Steam toasts" (§ 4.8).
6. `PanelSection` **Theme warnings**, only when there are some (18.7): one row per warning, label = the key, description
   = the message, right: a small button **Go** that opens the page owning the key. The messages are
   `resolveTheme(draft).warnings` (the same texts the "Theme problems" popup shows today), plus creator-only checks:
   Rare threshold above Magic's, a row gap of 10 px or more, an asset over 8 MB.

**What the toasts show**: sample text per type (Download complete: "Download complete" / the game's name / "Ready to
play"; Clip saved: "Clip saved" / "15 seconds"; and so on, a table in `settings/creator/model.ts`), the icon of a real
game in the library (the same appid `preview()` picks from `appAchievementProgressCache`, else a neutral bundled
placeholder), and for achievements that game's first achievement's icon, name and description when available, else
"First Steps" / "Finish the tutorial" with a placeholder icon.

**How a toast is drawn** (decided by spike S1/S2):

- **Notification toasts**: a mock of Steam's toast DOM using **Steam's own hashed classes** (the injected selectors,
  one class per part), inside a stage element marked `data-en-type`, plus the theme's CSS from
  `buildCss(style, sel, root)` and `buildAnimationCss(theme, sel, root)` scoped to the stage (§ 6.3). If S1 finds
  Steam's toast stylesheet is not in the modal's document, the stage also gets a small baseline stylesheet with the
  values measured live (template 70 px, padding 10, Steam's colours, fonts), written down in steam-components.md.
- If S2 finds Steam's own toast dispatcher (the component `setSteamToast` already receives) renders a synthetic
  notification outside a toast window, the stage renders **that** instead of the mock: Steam's real markup.
- **Achievement banners**: the injected `BannerCard` (§ 6.4) with the draft's resolved achievement theme. The same
  markup as the real banner.

### 4.7 Sounds (R6, R7)

Two places pick sounds, built from the same rows:

**1. The Sound pack panel** (`PanelSection` "Sound pack" on the Sound page; R14). Pick a pack, then pick a cue for
each target, one block per target:

```
 SOUND PACK
 ┌──────────────────────────────────────┐
 │ Pack                                 │
 │ Strings · Celtic concert strings     │
 │ [ Celtic Harp                    ▾ ] │
 └──────────────────────────────────────┘
 ┌──────────────────────────────────────┐
 │ Subtle                         [▶]   │
 │ 0.95 s                               │
 │ Distinct                       [▶]   │
 │ 1.4 s                                │
 │ Grand                          [▶]   │
 │ 2.2 s                                │
 └──────────────────────────────────────┘
 ┌──────────────────────────────────────┐
 │ Normal                         [▶]   │
 │ Now: Steam's chime · often Subtle    │
 │ [ Keep                           ▾ ] │   Keep / Subtle / Distinct / Grand
 │ Volume                          80   │
 │ ───────────────●──────────           │
 └──────────────────────────────────────┘
   … the same block for Notification, Magic, Rare, Exceptional …
 ┌──────────────────────────────────────┐
 │ Apply to the theme           [Apply] │
 │ Changes the rows not set to Keep     │
 └──────────────────────────────────────┘
```

- Blocks: the `FullWidthRows` "Pack" dropdown; the three cues to listen to (one `Field` row each with ▶); one block per
  target (**Notification**, then **Normal, Magic, Rare, Exceptional**): a header `Field` (label = the target,
  description = "Now: <its current sound>", right: ▶ playing the new choice at that volume), a `FullWidthRows`
  Dropdown **Keep / Subtle / Distinct / Grand**, and a Volume slider (disabled on Keep); last, a `ButtonRow` "Apply to
  the theme" [Apply] (one undo step).
- **Keep** leaves that sound as it is now (another pack, a file, Steam's chime, mute). Every target starts on Keep;
  nothing is preselected. While on Keep, the description adds a hint of a common pairing ("often Subtle" for Normal
  and Magic, "often Distinct" for Rare, "often Grand" for Exceptional).
- A target whose current sound is already a cue of the chosen pack opens on that cue, so reopening shows the current
  choices.
- The four tier blocks show only when the theme has an `achievements` block (18.7); otherwise one `Field` row "Turn
  on the achievement banner to give each tier its own sound".

**2. The single sound picker**, a popup (18.6) opened by "Choose a sound" on the Sound page and on each tier page, for
one sound from any pack or from a file:

- Block: `FullWidthRows` Dropdown Source (Library / This theme's files).
- Library: block of `FullWidthRows` Dropdowns Category (All, Chiptune, Bells, Strings, Orchestral, World, Synth),
  Pack, Cue (Subtle / Distinct / Grand); then a block with a `Field` "Listen" (description: the length) and ▶, and the
  Volume slider.
- This theme's files: `FullWidthRows` Dropdown File (`.mp3` and `.wav`, and `.ogg`, which themes already accept, in
  the theme's own folder, backend `ListThemeAssets`, § 6.7); then a block `ButtonRow` "Import a file" [Import…] (spike
  S4: Steam's file dialog), or, without one, a `Field` "Theme folder" with two small buttons [Open] [Rescan].
- `ActionRow`: status = the selection ("Celtic Harp · Distinct, 1.4 s"), buttons Cancel and Use.
- Mixing packs (Normal from one pack, Rare from another) is done here.

**Playback** goes through `audio()` (the plugin's one `AudioContext`); each clip is decoded once and cached for the
modal's life. Playing a new clip stops the previous one. A click resumes a suspended context (a user gesture), as
`preview()` does. **Steam's chime** (an unset sound): ▶ plays Steam's own toast sound if spike S5 finds its URL;
otherwise the ▶ is disabled and the description says "Plays with Test on screen". Every ▶ in the preview's Sounds
section plays exactly what that toast would play: the tier's clip, else the notification sound, else Steam's chime,
`false` = nothing (`theme/theme.ts` `soundSpecFor`, which agrees with `surfaces/sound/sound.ts`, § 10).

### 4.8 Test on screen (D5, D6)

"Test on screen" shows the current set as **real Steam toasts** with the draft, one after another, then the active
theme comes back:

1. The creator calls `active-theme.ts` `loadDraft(text, dir)` (the settings area may import `theme`).
2. The draft goes through the same load path as a theme file (resolve, assets, decoded sounds), without the RPC: `activeTheme()`, `achievementTheme()`, `themeCss()` etc. now answer
   the draft; listeners fire (style, duration and queue surfaces react as on any theme change).
3. The injected `preview(id)` and `previewTier(tier)` fire the set.
4. `clearDraft()` reloads the active theme after the last toast's lifetime + 2 s, on modal close, on the next Test, or after 2 minutes,
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

Cue files (Q2, Q3): `PS4/WAV/trophy_ps4_<x>.wav` → `subtle.wav`, `PS5/WAV/trophy_ps5_<x>.wav` → `distinct.wav`,
`PLATINUM/WAV/trophy_platinum_<x>.wav` → `grand.wav`. The MP3s and the READMEs are not shipped (the READMEs say
"PS4 Chime" etc.).

### 5.2 Files and manifest

```
enhanced-notifications/themes/sounds/
  library.json
  celtic_harp/subtle.wav
  celtic_harp/distinct.wav
  celtic_harp/grand.wav
  …
```

`library.json`:

```json
{
  "version": 1,
  "cues": [
    { "id": "subtle",   "label": "Subtle",   "seconds": 0.95 },
    { "id": "distinct", "label": "Distinct", "seconds": 1.4 },
    { "id": "grand",    "label": "Grand",    "seconds": 2.2 }
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
Windows 10+): reads the zips from a source folder, extracts only the three WAVs, writes them under the pack id as
`subtle.wav` / `distinct.wav` / `grand.wav`, checks each is a readable 48 kHz WAV of the expected length (± 0.1 s),
and writes `library.json` from a table in the script (§ 5.1). Re-runnable; it refuses to overwrite a pack folder whose
files differ unless `--force`. The source zips then move to `assets-src/sfx/` (§ 3.2).

### 5.4 How a theme uses a library sound

In the creator, a library pick is stored in the draft as the path it **will** have after saving,
`<theme>/<pack>_<cue>.wav`, and a side table `pendingCopies` maps it to its source (`library:<pack>/<cue>.wav`). The
preview loads the source; Save copies it (§ 6.6). A saved theme therefore never points into the bundled folder, and
stays valid when the plugin updates. A bundled template theme the user makes (Q7) can use `sounds/<pack>/<cue>.wav`
directly, relative to the bundled folder, which is its own folder; a Save as from it copies those files like any other
template asset.

### 5.5 Licensing

The packs are procedurally generated (the READMEs say "100% Procedural DSP Audio"), so they can ship in the public
repo. The Sony files listed in TASK.md § Considerations are not touched by this plan. The creator's template list
includes `ps5` and `SteamStation` as they are; saving a copy copies their assets into the user folder only, which never
ships.

---

## 6. Architecture

### 6.0 Where it sits: no new layer, no new area

The creator adds **no layer, no area, no feature id and no Steam target**. Every piece goes into a layer
[enhanced-notifications.md § Layers](../enhanced-notifications.md#layers) already has, by what it does:

| Piece | Layer it belongs to | Why there |
| --- | --- | --- |
| The modal and its pages, preview stage, pickers | **Settings panel** (`frontend/settings/creator/`) | It is UI the user opens from the settings panel. `areaOf` puts every file under `settings/` in the `settings` area, so the creator is part of that area, not a new one |
| Small pure helpers only the modal needs (sample texts, preview sets, the Sound pack rows, HSL ↔ hex) | **Settings panel**, one pure file `settings/creator/model.ts` | UI logic, not theme logic: keeping it out of `theme/` keeps the pure domain about themes |
| Editing a theme document: set / unset by path, history, "inherited from", serialise to JSONC, the asset copy plan | **Pure domain**, one file `theme/draft.ts` | It is the theme format, the same domain as `resolveTheme` and `parseJsonc` |
| The CSS root parameter on `buildCss` / `buildAnimationCss` | **Pure domain** (`theme/theme.ts`, existing functions) | No new file |
| Which sound a toast plays, for the preview's 🔊 | **Pure domain**, one function `soundSpecFor(theme, tier)` in `theme/theme.ts` | The resolved theme already holds both sounds; no new file |
| "Test on screen": the draft as the active theme for a moment | **Pure domain's loader** (`theme/active-theme.ts`) | It is one more way to load a theme; every surface already follows `onThemeChange` |
| The banner's markup, shared by the real banner and the preview | **Surface** `surfaces/banner/` (new file `banner-card.tsx`), **injected** into the panel by `index.tsx` | The panel never imports a surface (`onPreview` etc. are injected today); a separate `ui/` area for one component would be a new layer |
| Steam's toast class names for the mock toasts | Already resolved once at start-up by `index.tsx` (`resolveToastSelectors`), **injected** | Guardrail 3 (single-pass webpack scan): the creator never scans webpack again |
| Opening the dialog | `steam/modal.ts` `showDialog` | The panel already imports it (`settings -> steam`, read-only helpers) |
| Reading and writing theme files | **Backend** `backend/main.lua` | Already "owns only what the frontend cannot do itself: reading theme files"; it now also writes them, in the user folder only |

**Why no feature id.** enhanced-notifications.md § How to add a feature, step 1: a feature id is for something that
**writes into Steam**. The creator writes theme files; "Test on screen" shows toasts through the existing `preview`
surface (gated by `preview`) and changes looks through the existing surfaces (gated by theirs). A crash in the modal is
caught by its own error boundary and logged; it cannot affect a toast.

### 6.1 New and changed files

| File | Layer (area) | Pure | Job |
| --- | --- | --- | --- |
| `frontend/settings/creator/index.tsx` | settings | no | `openThemeCreator(deps)`: sizes and opens the dialog |
| `frontend/settings/creator/theme-creator.tsx` | settings | no | The modal: header, navigation, columns, error boundaries |
| `frontend/settings/creator/pages/*.tsx` | settings | no | Start, Placement, Card, Text, Icons, Sound, Achievements (Layout, tiers), Code |
| `frontend/settings/creator/preview.tsx` | settings | no | The stage: Gallery and On screen, Replay, Loop, mock toasts with Steam's classes |
| `frontend/settings/creator/sounds.tsx` | settings | no | The Sound pack panel, the single sound picker, playback |
| `frontend/settings/creator/controls.tsx` | settings | no | Colour swatch, linked edges, "inherited from" row, ↺ unset |
| `frontend/settings/creator/model.ts` | settings | **yes** | Sample texts, preview sets, `currentCues` / `applyPack`, HSL ↔ hex |
| `frontend/theme/draft.ts` | theme | **yes** | `set` / `unset` by path, history, `effectiveSource`, `serialize` (JSONC out), `copyPlan` (§ 6.6). One file; split only past ~400 lines |
| `frontend/theme/theme.ts` | theme | yes | `buildCss` / `buildAnimationCss` take an optional `root` (default `body[data-en-type]`, output unchanged); `soundSpecFor(theme, tier)` |
| `frontend/theme/active-theme.ts` | theme | no | `loadDraft(text, dir)` / `clearDraft()` (§ 4.8) |
| `frontend/surfaces/banner/banner-card.tsx` | surfaces/banner | no | The banner's markup, moved out of `ThemedBanner` (D7) |
| `frontend/surfaces/banner/themed-toast.tsx` | surfaces/banner | no | Renders `BannerCard`; queue, pin, hold and timing unchanged |
| `frontend/surfaces/banner/index.ts` | surfaces/banner | no | Exports `BannerCard` for `index.tsx` |
| `frontend/settings/settings-panel.tsx` | settings | no | The "Theme Creator" block; passes the injected `creator` deps on |
| `frontend/settings/rows.tsx` | settings | no | `FullWidthRows`, `ActionRow`, `IconButton`, `BUTTON_STYLE` copied from steam-cartridges' `settings/components.tsx`; controlled twins of `ToggleRow` / `SliderRow`, the key-bound ones becoming wrappers (§ 4.3). The panel looks the same after |
| `frontend/rpc.ts` | rpc | no | `saveTheme`, `deleteTheme`, `listThemeAssets`, `soundLibrary` |
| `frontend/index.tsx` | composition root | no | Builds the one `creator` deps object (below) and passes it to `SettingsPanel` |
| `backend/main.lua` | backend | — | `SaveTheme`, `DeleteTheme`, `ListThemeAssets`, `SoundLibrary` |
| `themes/sounds/**`, `tools/import-sfx.mjs` | — | — | § 5 |
| `tests/draft.test.ts`, `tests/creator.test.ts` | tests | — | § 10 |
| `tests/creator.mjs` | tests (live) | — | § 10 |

What is **not** added, on purpose: no `frontend/creator/` or `frontend/ui/` area, no `FEATURE_IDS` entry, no surface,
no sensor, no kernel type, no new `touches`, no `OWNERS` row.

The injected deps, one object, so `SettingsPanel`'s props grow by one:

```ts
/** index.tsx → SettingsPanel → openThemeCreator. Everything the creator needs from a surface or from start-up. */
interface CreatorDeps {
    selectors: ToastSelectors;                         // resolved once at start-up (kernel type)
    sidebarClasses: Record<string, string>;            // Steam's Settings sidebar classes, same start-up scan (S7)
    previewOptions: PreviewOption[];                   // already injected today
    pickPreview: (ids: readonly string[], last: string | null) => string | null;
    preview: (id: string) => Promise<unknown>;         // Test on screen, notifications
    previewTier: (tier: Tier) => Promise<void>;        // Test on screen, achievements
    BannerCard: React.ComponentType<BannerCardProps>;  // the real banner's markup
}
```

`ToastSelectors` is a kernel type (every layer may use the kernel). `BannerCardProps` is declared in
`settings/creator/` as the props the creator passes, and `banner-card.tsx` is typed against the same shape through the
injection in `index.tsx` (the composition root may import both), so neither side imports the other.

### 6.2 Layer rules (`tests/architecture.test.ts`)

**One** change to `LAYER_RULES`: the settings panel may read the pure banner domain (the creator's On screen mode
places banners with `banner/geometry.ts` `bannerSize` / `placeBanner`, and times Loop exit with `banner/timing.ts`).

```ts
// before
[/^settings$/, /^(rpc|theme|capture|steam)$/], // previews are injected as a prop; capture holds the sliders' ranges; steam is the read-only toasts-off flag
// after
[/^settings$/, /^(rpc|theme|capture|steam|banner)$/], // ... ; banner: the pure banner domain (geometry, timing) for the Theme Creator's preview
```

`banner/` is pure domain; the surfaces and `capture` already read it. The allowlist stays empty. The rules test gains
`'settings -> banner'` in `allowed` and `'settings -> surfaces/banner'` in `forbidden` (next to the existing
`'settings -> surfaces/preview'`), so the injection cannot quietly turn into an import.

`PURE` gains two files: `theme/draft.ts` and `settings/creator/model.ts`. Both may import only other pure files at
runtime (the existing purity test enforces it).

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
`<style>{BANNER_CSS}</style>`, and the layout switch for `ps5` / custom / classic). It stays in `surfaces/banner/`, the
banner's own folder: it is markup and writes nothing into Steam. `ThemedBanner` keeps every hook, the queue, the pin,
the hold and the timing, and passes its values in. A pure refactor: the achievement live suite (`achievements-smoke`,
`-tiers`, `-queue`, `-bigpicture`) must pass unchanged before anything else in the creator lands.

### 6.5 The draft

```ts
interface CreatorDraft {
    name: string;                         // file stem, [A-Za-z0-9_-]{1,40}
    origin: { kind: 'fresh' } | { kind: 'template' | 'user'; id: string; dir: string; hadComments: boolean };
    raw: Record<string, unknown>;         // the theme JSON, edited by path
    pendingCopies: Record<string, AssetSource>;  // saved path → where it is now
}
type AssetSource = { kind: 'library'; pack: string; cue: string } | { kind: 'dir'; dir: string; path: string };
```

The type lives in `theme/draft.ts` (pure). Every edit is `set(raw, path, value)` / `unset(raw, path)` and returns a
new object (history = an array of snapshots, 100 deep). `useMemo(() => resolveTheme(raw), [raw])` gives the preview
what the plugin would use (guardrail 17: resolving is pure work in render; asset loading is an effect keyed by the set
of asset paths, debounced 250 ms, cached by `(dir, path)`).

### 6.6 Saving

`SaveTheme` is called with the final text and a copy list, built by `theme/draft.ts` `copyPlan(draft)`:

1. Collect every asset path in `raw` (the same walk `resolveTheme` uses for `assetPaths`).
2. For each relative path: if it already lies under `<name>/` and the draft is a user theme with that name, keep it.
   Else it is copied to `<name>/<basename>` (a clash gets `-2`, `-3`) and the path in `raw` is rewritten. Library
   picks come from `pendingCopies`.
3. Absolute paths are kept as they are (the user chose them; themes.md allows them).
4. The text is `serialize(raw)`.

Backend `SaveTheme { name, text, overwrite, backup, copies: [{ from: 'bundled' | 'user' | 'library', path, to }] }`:

- `name` must match `^[A-Za-z0-9_-]{1,40}$`; the file is `<userDir>/<name>.jsonc`; nothing outside `<userDir>` is ever
  written (checked after joining, like `find_theme`'s `..` check). The bundled folder is never a target (R15).
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
  `LoadAssets(dir, ['celtic_harp/subtle.wav'])`.

Each is registered in `backend/main.lua` (architecture test rule 4) and wrapped by `method()`.

### 6.8 Owners

The "Steam targets and their one owner" table and `OWNERS` are for **writes into Steam**; the creator adds none, so
neither changes. Two non-Steam writers, documented in prose in enhanced-notifications.md (§ 6.10), not in that table:

- Theme files in the user folder: only `backend/main.lua` `SaveTheme` / `DeleteTheme`.
- The draft as the active theme: only `theme/active-theme.ts` `loadDraft` / `clearDraft`, called only from
  `settings/creator/`. One architecture test line checks no other file calls `loadDraft` (the leak guard of § 4.8).

### 6.9 Safety

- No feature id (§ 6.0). Each column of the modal has an error boundary that shows "This section failed" and logs;
  the modal and the toasts cannot take each other down.
- Test on screen is gated by the existing `preview` id and by the surfaces' own ids, like any preview.
- The draft load is bounded (§ 4.8) and cleared in a `finally` and on unmount.
- Safe mode: nothing is hooked, so Test on screen does nothing (the injected `preview` returns null); the rest of the
  creator (editing, saving) still works, as the rest of the settings panel does.

### 6.10 Doc changes this implies (P10)

enhanced-notifications.md: the **Layers** table's Settings panel row gains `settings/creator/` ("the Theme Creator
modal; `model.ts` is pure"); the **Pure domain** row gains `theme/draft.ts`; the Settings panel section gains a short
"Theme Creator" paragraph (what is injected, Save-as-only templates, the two non-Steam writers). No new row in the
Safety net or Steam targets tables; "How to add a feature" is unchanged.

---

## 7. Data flow

```
index.tsx ── creator deps (selectors, previews, BannerCard) ──► SettingsPanel ──► settings/creator (modal)
                                                                                    │
     rpc.listThemes / loadTheme / soundLibrary / listThemeAssets ◄─────────────────┤ Start page, pickers
                                                                                    │
     draft.raw ──► resolveTheme (theme/, pure) ──► style, achievements, warnings    │
                       │                                                            │
                       ├─► buildCss(root=stage) ─► <style> in the stage             │ Preview: mock toasts
                       ├─► BannerCard (injected)                                    │          banners
                       └─► soundSpecFor ─► audio() ─► 🔊                           │          sounds
                                                                                    │
     Save ─► copyPlan + serialize (theme/draft.ts) ─► rpc.saveTheme ─► backend writes the user folder
                                     └─► refresh list, reloadTheme (and set `theme` on "Save as and use")
     Test on screen ─► active-theme loadDraft ─► injected preview()/previewTier() ─► real toasts ─► clearDraft
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
| S7 | Which CSS module holds Steam's Settings sidebar classes (page list, selected page, separators), and do they style a plain `Focusable` list in the popout? | Find the module by its keys (as `steam/selectors.ts` does), render a three-item list | The navigation's look; fallback: a small own stylesheet in Steam's colours |
| S8 | `ListThemes` and the existing panel keep working with a `themes/sounds/` folder present | Offline: Lua test | Phase 1 safety |
| S9 | The settings panel's inner horizontal padding, row heights and `PanelSection` title spacing in Millennium's sidebar, and whether `Field` / `PanelSection` render the same in the popout | Measure both with `getBoundingClientRect` / computed styles, the way guardrail 18's values were measured | Each column's padding (§ 4.3); a fix-up only if the popout differs |

---

## 9. Phases

Each phase ends green: `npm run check` clean, `npm test` all pass, `npm run build` clean, the live suite as stated,
committed. A phase's mechanical plan is written when it starts.

| Phase | Scope | Exit check |
| --- | --- | --- |
| **P1 Sound library** | `tools/import-sfx.mjs`; `themes/sounds/` (17 packs × 3 WAV, `library.json`); move the zips to `assets-src/sfx/`; `.gitignore`; themes.md § "Sound library" (how a bundled theme refers to `sounds/<pack>/<cue>.wav`); `SoundLibrary` RPC | The import script prints 17 packs, 51 files, all lengths in range; `npm test`; Lua test: `ListThemes` unchanged with `themes/sounds/` present. By ear (the user): a template theme the user writes with library sounds plays them on the tier previews |
| **P2 Pure groundwork** | `theme/draft.ts` (paths, history, `effectiveSource`, `serialize`, `copyPlan`), `theme/theme.ts` (`root` param, `soundSpecFor`), `settings/creator/model.ts`; both new files in `PURE`; unit tests | `npm test`: new tests pass; `serialize(parseJsonc(x))` re-resolves to the same `resolveTheme` result for every bundled theme |
| **P3 BannerCard refactor** | `surfaces/banner/banner-card.tsx`, `themed-toast.tsx` uses it, exported from `surfaces/banner/index.ts`; no layer rule change | `npm test`; deploy; `npm run test:live` achievement checks pass as before (with the lock) |
| **P4 Backend writes** | `SaveTheme`, `DeleteTheme`, `ListThemeAssets`; Lua tests (name validation, path escape refused, copy refused for a disallowed type, atomic write) | Lua tests pass; architecture test (RPCs registered) |
| **P5 Spikes S1-S7, S9** | § 8 | Findings written into the docs |
| **P6 Modal shell** | `rows.tsx` additions (§ 4.3; the settings panel unchanged, checked live by eye and by `achievements-settings`), entry button, modal at its size, the three columns and the action row, Start page, header, Save / Save as / Save and use / Delete, unsaved guard, `localStorage` draft, Code page | Live: open, start from each source, save a copy of `ps5`, it loads in the dropdown and its assets resolve from the user folder |
| **P7 Editor pages** | Placement, Card, Text, Icons, Sound (without the library picker), Achievements Layout and tiers with "inherited from" | Live by hand: each control changes the saved file as expected; ↺ removes the key |
| **P8 Preview** | Stage (Gallery, On screen, Desktop / Big Picture look), sets, Replay, Loop exit, warnings strip, 🔊, sound picker with the library | Live: the four sets render; changing a colour updates the preview in under 100 ms; each 🔊 plays the expected clip |
| **P9 Test on screen** | `loadDraft` / `clearDraft`, bounds, the `loadDraft` caller check | `tests/creator.mjs` passes; after a test the active theme's CSS and durations are back (compared before/after) |
| **P10 Docs** | ADR-0059, enhanced-notifications.md (layers, owners, feature id, Theme Creator section), themes.md (sound library, "made with the Theme Creator"), CHANGELOG, TASK | Docs review |

P1 and P2 can run in parallel; P3 before P8; P4 before P6.

---

## 10. Tests

**Unit (`npm test`)**

- `draft.test.ts` (`theme/draft.ts`): set / unset create and prune empty objects; undo / redo; `effectiveSource` for
  every tier and `BANNER_KEYS` key (Normal → All tiers → Card → Steam's own); for each bundled theme,
  `resolveTheme(parseJsonc(serialize(raw)))` deep-equals `resolveTheme(raw)`; key order; tuples on one line; unknown
  keys kept; `copyPlan` (template paths copied and rewritten, clashes numbered, absolute kept, library picks).
- `creator.test.ts` (`settings/creator/model.ts`): preview sets (four distinct, never Achievement in the notification
  sets); HSL ↔ hex round trips; `applyPack` (a Keep row is untouched whatever it held, each cue writes
  `<theme>/<pack>_<cue>.wav` with its volume and one `pendingCopies` entry, tier rows ignored without an
  `achievements` block) and `currentCues` (reopening the panel shows what Apply wrote).
- `theme.test.ts` (extended): `buildCss` / `buildAnimationCss` with the default root produce exactly today's output;
  `soundSpecFor` agrees with `surfaces/sound/sound.ts` on the same cases (tier clip, else notification sound, `false`
  mutes, else Steam's).
- `architecture.test.ts`: `'settings -> banner'` allowed, `'settings -> surfaces/banner'` forbidden; `PURE` gains
  `theme/draft.ts` and `settings/creator/model.ts`; only `theme/active-theme.ts` and `settings/creator/` mention
  `loadDraft`; the four new RPCs registered. `OWNERS`, `FEATURE_IDS` and the allowlist unchanged.

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
| [2 (hot paths O(1))](../plugins.md#2-zero-expensive-operations-in-hot-prototype-methods-o1-strictly-enforced) | The draft is loaded like any theme, before a toast; toast-time reads stay cached values |
| [3 (single-pass webpack scan)](../plugins.md#3-single-pass-webpack-module-pre-caching) | The creator gets Steam's toast selectors from start-up through injection; it never scans webpack (S7's sidebar classes are resolved in the same start-up pass) |
| [12 (popup hooks)](../plugins.md#12-popup-hooks-do-not-see-every-window) | The preview's CSS is a `<style>` inside the stage element, never injected by a window hook |
| [15 (never weaken a check)](../plugins.md#15-never-weaken-a-verification-check-to-match-new-behaviour) | P3's refactor must pass the achievement live checks unchanged |
| [17 (a render never starts work)](../plugins.md#17-a-render-never-starts-work-a-refresh-never-leaves-its-own-components) | RPCs, asset loads and decoding run in effects and click handlers; render only resolves and builds CSS (pure) |
| [18 (panel layout)](../plugins.md#18-settings-panel-layout-reference-enhanced-notifications) | Applied to **each column** of the modal and to every popup, as if each were the settings panel (§ 4.3, rule by rule): Steam's components through `rows.tsx`, two columns per row at most, dropdowns and text fields full width, `Blocks` spacing only, one block per key, `ActionRow` last, no empty-state rows, one icon-button size. The entry button is its own block. Exempt: the navigation list (Steam's sidebar look) and the stage (a canvas of toasts) |
| Architecture test / hexagon | No new area or layer: one added edge (`settings -> banner`, pure domain), two files added to `PURE`, empty allowlist kept, `OWNERS` and `FEATURE_IDS` unchanged (§ 6.0) |

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
| Name clash with a bundled theme hides it | Warning on Save as (§ 4.2) |

---

## 13. Do not touch / banned (for every phase plan)

- Do not change any surface's behaviour, `steam/*`, the notification hook, the banner queue or the toast patch,
  except P3's markup move (no logic change) and P9's override reader.
- Do not edit, add or remove bundled themes (`themes/*.json`, `themes/*.jsonc`): the user makes the shipped templates
  (Q7). Do not touch `themes/SteamStation/assets/` (`themes/PlayStation/`, `themes/assets/` and the rest of `SteamStation/`
  were deleted 2026-10-14, release plan § 3b; P1 restores only the `custom/sfx/` zips, from `6ece444`).
- Banned: deploy or Steam restart outside the Steam lock; SharedJSContext reload; edits to Millennium's `config.json`;
  `npm install` / upgrades; `git push --force`; `--no-verify`; AI attribution in commits (AGENTS.md Routine 6).
- Failure rule: a failing command at most twice, then stop and record it in TASK.md § Active failures.


---

## 14. Execution record (2026-10-14)

Built in order, each phase committed green (`npm run check`, `npm test` 205, `npm run test:lua` 27, `npm run build`):

| Phase | Commit | Notes |
| --- | --- | --- |
| P0 (added) Big Picture look | `d8e10ac` | The user: "add normal and big picture modes ... since on big picture mode we cant open millenium options". ADR-0068: `bigpicture` block, per-window CSS, Big Picture placement, sound / durations / banner by Steam's UI mode. Live: `tests/bigpicture-look.mjs` 8/8 in Big Picture |
| P1 sound library | `2631b18` | 17 packs, 51 WAVs (two Grand cues are 2.10 s, inside the ± 0.1 s), `library.json` with each cue's measured length, `SoundLibrary`, `dev.ps1` deploys `themes/sounds/`. The zips are in `assets-src/sfx/` (ignored), restorable from `6ece444` |
| P2 pure groundwork | `f06489d` | `theme/draft.ts` (with `modePath` / `viewOf` / `originOf` for Big Picture: set, From desktop, inherited, Steam's), `settings/creator/model.ts`, `buildCss` / `buildAnimationCss` `root`, `soundSpecFor`. Every bundled theme round-trips through `serialize` |
| P3 BannerCard | `121aeaa` | Achievement live checks pass unchanged (after the dispatcher fix below) |
| P4 backend writes | `e1c2211` | `SaveTheme`, `DeleteTheme`, `ListThemeAssets`; Lua suite with its own stubs (`tests/test_backend.lua`) |
| P5 spikes | (this record) | See below |
| P6-P9 modal, pages, preview, Test on screen | `5fc734b` + fixes | Live-checked by screenshot and `tests/creator.mjs` |
| P10 docs | this commit | ADR-0069, enhanced-notifications.md, themes.md, CHANGELOG, TASK |

**Spikes (§ 8), as answered:**

- **S1/S2 (Steam's toast CSS / real markup in the popout):** made moot. The stage styles its own mock elements with the
  plugin's `buildCss` through a mock selector set, so it needs neither. Baseline look: Steam's measured template heights
  (70 / 40 px) and hover gradient, other values approximated (S9 not measured).
- **S3 (ColorPickerModal in a popout):** not used; the creator's own picker (Steam's sliders and text field) instead.
- **S4 (native file dialog):** not built; the sound picker and icon slots list the theme folder's files, with Open and
  Rescan.
- **S5 (Steam's chime):** not played in the preview; its rows say "plays with Test on screen".
- **S6 (popout size):** the dialog opens at the clamped size (1100-1280 x 720-860) once Steam's `showModal` is found again
  (it moved in Steam 1791918634, steam-components.md).
- **S7 (Settings sidebar classes):** not used; the navigation has its own small style in Steam's colours.
- **S8:** `ListThemes` never lists `sounds/library.json` (Lua test).

**Deviations from the design:** the colour picker is the creator's own (S3); the creator's dialogs open over its own
window, not as separate popouts (parenting them to the creator window); "Choose notifications" is four inline dropdowns
instead of a popup; the theme warnings are rows without a Go button; the Start page does not preview a template on hover.

**Found on the way (not the creator's):** Steam 1791918634 broke two lookups, both fixed: the toast dispatcher (a table
lookup replaced the `switch`; the banner had been off since the update) and Steam's `showModal` (dialogs fell back to
Millennium's, unsized). Steam's `ConfirmModal` logged "Trying to use ConfigContext without a provider" per dialog
under this build: fixed in the second pass (below).
`tests/bigpicture.mjs` measured "Steam's place" with the user's theme active and wiped the stored settings when run
alone; it now measures with Steam default and restores the settings.

**Second pass (same day): every "not built" item built, and the known issue fixed.**

- *Template preview:* hovering or focusing a template row on the Start page shows it on the stage after 300 ms
  ("Previewing the template ..."); leaving the row goes back to the draft.
- *Go per warning:* `pageForWarning` (pure, tested) maps each warning to its page and mode (a `bigpicture:` warning opens
  the Big Picture mode).
- *Import:* "Choose an image" on each icon slot and "Import a file" in the sound picker use Steam's file dialog
  (`steam/file-dialog.ts`, S4 answered: `SteamClient.System.OpenFileDialog`). A picked file is a pending copy
  (`FilePick`) and Save copies it into the theme's folder (backend source `file`, Lua-tested).
- *Steam's chime (S5):* the preview surface's `previewChime` plays the type's own Steam sound through a stand-in
  `PlayNotificationSound` call; achievements need `data.achieved()` on the stand-in (verified live: Steam picks sound 5
  for achievements, 6 for a download).
- *ConfigContext:* every dialog is now wrapped in Steam's `ConfigContextRoot` (`steam/modal.ts`, module 6739 `ss`):
  0 errors over a whole creator run (was 5-7).
- `tests/creator.mjs` gained the hover, chime and Go checks (19 checks).
- Observed once: Millennium v3.6.1 crashed with a stack overflow in `millennium.dll` at one Steam start right after a
  deploy (`crashes/millennium-20261014-223741`, the first Millennium crash on this machine); the next start with the same
  code was clean. Watch item.
