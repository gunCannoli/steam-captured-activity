# Enhanced Achievements

A [Millennium](https://steambrew.app/) plugin that themes Steam's achievement
notifications: a custom banner and sound for each rarity tier, from JSON themes
you can edit and share. It can also grab a screenshot, save a clip and add a
timeline marker automatically when you unlock an achievement.

- **Four rarity tiers**: normal (bronze), magic (silver), rare (gold) and
  exceptional (the unlock that completes the game), chosen from Steam's own
  global unlock percentage.
- **Custom sound per tier**, replacing Steam's chime. Steam's "play a sound
  with notifications" setting is still respected.
- **Themed banner** with gradients, borders, icons and animations, on the
  desktop client, in Big Picture, and in the in-game overlay.
- **Auto-captures on unlock** (opt-in): a screenshot, a clip and a timeline
  marker, using Steam's own Game Recording. Off by default.
- **Nothing breaks if something is wrong.** A missing sound falls back to
  Steam's chime, and a broken theme falls back to Steam's own toast.

## Install (alpha)

This is an alpha: expect rough edges, and please report anything odd.

**From a release zip:** unzip it into `<Steam>/millennium/plugins/`, then
enable **Enhanced Achievements** in Millennium and restart Steam.

**From source:**

```bash
npm install
powershell -ExecutionPolicy Bypass -File dev.ps1 -Release
```

`-Release` builds and deploys under the plugin's real name (not a `-dev`
copy) and enables it. Steam restarts automatically unless you pass
`-NoRestart`.

## Settings

Open Millennium's sidebar and select **Enhanced Achievements**:

| Setting | What it does |
| --- | --- |
| Theme | Which theme to use, or "Steam default" (the shipped default) for Steam's own stock toast and chime |
| Reload themes | Pick up edits to a theme file without restarting Steam |
| Open themes folder | Opens the folder for your own themes |
| Preview | Fires a test achievement for each tier |
| Achievement queue | One themed banner at a time instead of Steam's own stacking |
| Screenshot on unlock | Grabs a frame from Steam's game recording, `delay` after the unlock |
| Save clip on unlock | Saves the last `length` seconds, ending `delay` after the unlock |
| Timeline marker | Adds an achievement marker on non-Steam games' timelines |
| Reset to defaults | Clears every changed setting |
| Reset Achievements | Pick a game (type to filter the list) and press **Reset** to clear its achievements, after a warning. Steam games are cleared on your Steam account through Steam's own console command; non-Steam games need steam-cartridges. Only games with at least one unlocked achievement are listed |

Captures are **off by default** — they write files into your library. Both
screenshot and clip need Steam's Game Recording turned on (background or
manual) for the game.

## How to test

Five minutes, no game required for the first four:

1. Open the settings panel; **Theme** starts on "Steam default". Press
   **Preview** for each of the four tiers — Steam's own stock toast appears
   each time.
2. Switch **Theme** to `steam_tiers` (the bundled default) and press
   **Preview** again — a themed toast should now appear each time.
3. Edit `themes/steam_tiers.json` (or a copy in your themes folder), press
   **Reload themes**, then **Preview** again to see the change.
4. Start any game with Game Recording on (Steam Settings -> In-Game ->
   Recording), enable **Screenshot on unlock** and/or **Save clip on unlock**,
   then unlock an achievement for that game (previews never capture). Check Steam's
   Screenshots/Recordings for the game shortly after.

## Themes

A theme is one `.jsonc` (or `.json`) file plus the images and sounds it uses.
Comments are allowed in both. Start from
[themes/theme.jsonc](themes/theme.jsonc): every option, commented, in a working
theme. The full reference is [themes.md](themes.md). Also bundled:
[ps5](themes/ps5.jsonc) and [steam_tiers](themes/steam_tiers.json). Fuller,
asset-based examples are in [examples/](examples/) (not installed; copy what you
need into your own themes folder).

Put your themes in `<Steam>/millennium/config/enhanced-achievements/themes/`
(**Open themes folder** takes you there). That folder survives plugin updates.
A theme there with the same name as a bundled one replaces it.

To share a theme, share its folder: the `.jsonc` and an `assets/` folder, with
paths in the theme written relative to it (`"assets/gold.png"`).

The workflow is: edit the theme file, press **Reload themes**, press **Preview**.

## Known limitations

- **Banner size is Steam's.** Steam sizes and places the toast window itself
  (284×71 on the desktop client). A theme's `scale` enlarges text and icons
  within that frame, not the window. `position` follows Steam's own
  notification position setting.
- **Rarity needs Steam's data.** Games without global unlock percentages
  (including non-Steam games) always use the normal tier, except for the
  unlock that completes the game.
- **The in-game overlay is unverified** with a real in-game unlock.
- **Captures need Game Recording on**, and never happen if Steam's in-game
  toast notifications are disabled for that game — Steam itself never calls
  the hook this plugin uses in that case.
- **Steam already marks achievements on its own games' timelines.** The
  timeline marker only applies to non-Steam shortcuts.
- Banners, sounds and captures do nothing while Steam's own toast
  notifications are turned off entirely (Steam Settings -> Notifications).
  The settings panel shows a warning when it can detect this.
- On Millennium v3.4.1 the Configuration API only partly works (settings save,
  but Millennium may log an error). The plugin works around it; you should
  never see a broken save.

## Troubleshooting

- **A banner, sound or capture misbehaves.** Each part can be switched off on its own: in the SharedJSContext console run
  `PLUGIN_LIST['enhanced-achievements'].setSetting('disabledFeatures', 'banner,sound')`. Ids: `banner`, `sound`, `duration`,
  `completion`, `captures`, `toasts`. Steam's own toast, chime or duration comes back for that part. Empty string switches
  everything back on.
- **A part switched itself off.** After 5 errors in one session a part is switched off until Steam restarts.
  `PLUGIN_LIST['enhanced-achievements'].safetyDiagnostics()` shows what tripped and the error counts;
  `surfaceStatus()` shows which parts installed.
- **Safe mode.** If two starts in a row did not end cleanly, the next start hooks nothing (Steam's own toasts) and leaves safe
  mode after a clean run.

## Uninstall

Disable **Enhanced Achievements** in Millennium's plugin list, then delete
`<Steam>/millennium/plugins/enhanced-achievements` (and, if you used dev.ps1's
default deploy, `enhanced-achievements-dev`). Your themes in
`<Steam>/millennium/config/enhanced-achievements/` are left in place.
