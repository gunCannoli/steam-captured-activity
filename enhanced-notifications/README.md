# Enhanced Notifications

A [Millennium](https://steambrew.app/) plugin that restyles **every** Steam
notification (friends, messages, downloads, recordings, system, achievements)
from shareable JSON themes. It keeps Steam's own icons, logos and text, and
changes only how they look and sound:

- popup background (solid or gradient), border, glow, Steam-logo watermark
- font, title, body and subtext colours, sizes and weights
- game icon corner radius and visibility, header icon, text alignment
- position on screen, entrance and exit animation, margin, padding and gap
- sound (custom file, or `false` to mute) and display time

One style applies to every notification, so they all look alike. Anything a
theme doesn't set stays exactly as Steam draws it.

**Achievements, optionally themed further.** A theme can add an `achievements`
block that replaces Steam's achievement toast with a themed banner on the same card (this was
the Enhanced Achievements plugin, now part of this one):

- **Four rarity tiers**: normal (bronze), magic (silver), rare (gold) and
  exceptional (the unlock that completes the game), chosen from Steam's own
  global unlock percentage.
- **Custom sound per tier.** Steam's "play a sound with notifications" setting
  is still respected.
- **Themed banner** with gradients, borders, icons and animations, on the
  desktop client, in Big Picture, and in the in-game overlay.
- **Auto-captures on unlock** (opt-in, any theme): a screenshot, a clip and a
  timeline marker, using Steam's own Game Recording. Off by default.
- **Nothing breaks if something is wrong.** A missing sound falls back to the
  notification sound (or Steam's chime), and a broken `achievements` block
  falls back to the notification style.

## Install (alpha)

This is an alpha: expect rough edges, and please report anything odd.

**From a release zip:** unzip it into `<Steam>/millennium/plugins/`, then
enable **Enhanced Notifications** in Millennium and restart Steam.

**Coming from Enhanced Achievements?** Disable it in Millennium first (this
plugin does everything it did, and the two must not run together). Your
Enhanced Achievements theme works as this plugin's `achievements` block: see
[themes.md § achievements](themes.md#achievements). Your settings (queue,
captures) are set again once in this plugin's panel.

**From source:**

```bash
npm install
powershell -ExecutionPolicy Bypass -File dev.ps1 -Release
```

`-Release` builds and deploys under the plugin's real name (not a `-dev`
copy) and enables it. Steam restarts automatically unless you pass
`-NoRestart`.

## Settings

Open Millennium's sidebar and select **Enhanced Notifications**:

| Setting | What it does |
| --- | --- |
| Theme | Which theme to use |
| Reload themes | Pick up edits to a theme file without restarting Steam. If the theme has errors, a popup lists them (a field that falls back to its default, a missing asset, or why the theme could not load) |
| Themes folder | Opens the folder for your own themes |
| Preview a notification | Shows a random notification (one of Steam's own test toasts, or an achievement), a different type each press |
| Preview achievement tiers | Fires a test achievement for each tier (the banner, or the notification style without an `achievements` block) |
| Themed style | Off: Steam's own look for every notification, achievements included |
| Themed sounds | Off: Steam's own sounds. Steam's mute setting is always respected |
| Themed display time | Off: Steam's own display time per notification |
| Achievement queue | One achievement banner at a time instead of Steam's own stacking |
| Screenshot on unlock | Grabs a frame from Steam's game recording, `delay` after the unlock |
| Record clip on unlock | Saves the last `length` seconds, ending `delay` after the unlock |
| Timeline marker | Adds an achievement marker on non-Steam games' timelines |
| Reset to defaults | Clears every changed setting |
| Reset Achievements | Pick a game (type to filter the list) and press **Reset** to clear its achievements, after a warning. Steam games are cleared on your Steam account through Steam's own console command; non-Steam games need steam-cartridges to be cleared. Only games with at least one unlocked achievement are listed |

Captures are **off by default**: they write files into your library. Both
screenshot and clip need Steam's Game Recording turned on (background or
manual) for the game.

## How to test

Five minutes, no game required for the first four:

1. Open the settings panel and press **Preview a notification** a few times:
   each press shows a different notification type (downloads, clips, cloud
   sync, battery, updates, an achievement), all restyled the same way.
2. Switch **Theme** to `ps5` and press each **Achievement** preview: a PS5-style
   trophy banner per tier. Back on `steam_midnight` (no `achievements` block),
   the same previews look like every other toast.
3. Toggle **Themed style**, **Themed sounds** and **Themed display time** off
   and on; confirm Steam's own look/sound/timing comes back when off.
4. Edit a theme (a copy in your themes folder), press **Reload themes**, then
   preview again to see the change.
5. Start any game with Game Recording on (Steam Settings -> In-Game ->
   Recording), enable **Screenshot on unlock** and/or **Record clip on
   unlock**, then unlock an achievement for that game (previews never capture).
   Check Steam's Screenshots/Recordings for the game shortly after.

## Themes

Themes are `.jsonc` (or `.json`) files: JSON with `//` comments and trailing
commas allowed. Start from [themes/theme.jsonc](themes/theme.jsonc): every
option, commented, in a working theme. The full reference is
[themes.md](themes.md). Also bundled: [steam_midnight](themes/steam_midnight.json),
[ps5](themes/ps5.jsonc) and [steam_tiers](themes/steam_tiers.json). Fuller,
asset-based examples are in [examples/](examples/) (not installed).

Put your own in `<Steam>/millennium/config/enhanced-notifications/themes/`
(**Themes folder** takes you there). That folder survives updates, and a theme
there replaces a bundled one with the same name. To share a theme, share its
folder: the `.jsonc` and an `assets/` folder, with paths in the theme written
relative to it (`"assets/gold.png"`).

The workflow is: edit the theme file, press **Reload themes**, press **Preview**.

## Known limitations

- Friend and message toasts depend on Steam's Friends notification settings:
  if Steam wouldn't show the toast, there's nothing for this plugin to style.
- The in-game overlay is not yet verified with a real in-game unlock.
- Desktop toast frame is 284×71; Big Picture's is 300×80, for the banner too.
- **Rarity needs Steam's data.** Games without global unlock percentages
  (including non-Steam games) always use the normal tier, except for the
  unlock that completes the game.
- **Captures need Game Recording on**, and never happen if Steam's in-game
  toast notifications are disabled for that game: Steam itself never calls
  the hook this plugin uses in that case. Steam already marks achievements on
  its own games' timelines; the timeline marker only applies to non-Steam
  shortcuts.
- Styling, sounds, display time and captures do nothing while Steam's own
  toast notifications are turned off entirely (Steam Settings ->
  Notifications). The settings panel shows a warning when it can detect this.
- On Millennium v3.4.1 the Configuration API only partly works (settings save,
  but Millennium may log an error). The plugin works around it; you should
  never see a broken save.

## Troubleshooting

- **Styling, a banner, a sound or a capture misbehaves.** Each part can be switched off on its own: in the SharedJSContext
  console run `PLUGIN_LIST['enhanced-notifications'].setSetting('disabledFeatures', 'style,sound')`. Ids: `style`,
  `sound`, `duration`, `preview`, `placement`, `banner`, `completion`, `captures`, `toasts`, `reset`. Steam's own look,
  toast, sound or duration comes back for that part. Empty string switches everything back on.
- **A part switched itself off.** After 5 errors in one session a part is switched off until Steam restarts.
  `PLUGIN_LIST['enhanced-notifications'].safetyDiagnostics()` shows what tripped and the error counts;
  `surfaceStatus()` shows which parts installed.
- **Safe mode.** If two starts in a row did not end cleanly, the next start hooks nothing (Steam's own toasts) and leaves safe
  mode after a clean run.

## Uninstall

Disable **Enhanced Notifications** in Millennium's plugin list, then delete
`<Steam>/millennium/plugins/enhanced-notifications` (and, if you used
dev.ps1's default deploy, `enhanced-notifications-dev`). Your themes in
`<Steam>/millennium/config/enhanced-notifications/` are left in place.
