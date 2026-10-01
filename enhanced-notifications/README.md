# Enhanced Notifications

A [Millennium](https://steambrew.app/) plugin that restyles **every** Steam
notification (friends, messages, downloads, recordings, system, achievements)
from shareable JSON themes. It keeps Steam's own icons, logos and text, and
changes only how they look and sound:

- popup background (solid or gradient), border, glow, Steam-logo watermark
- font, title, body and subtext colours, sizes and weights
- app-logo corner radius and visibility, header icon
- position on screen, entrance and exit animation, margin, padding and gap
  (same options as Enhanced Achievements)
- sound (custom file, or `false` to mute) and display time

One style applies to every notification, so they all look alike.

Anything a theme doesn't set stays exactly as Steam draws it.

Works alongside **Enhanced Achievements**: when that plugin is active, it
handles achievement toasts and this one leaves them alone.

## Install (alpha)

This is an alpha: expect rough edges, and please report anything odd.

**From a release zip:** unzip it into `<Steam>/millennium/plugins/`, then
enable **Enhanced Notifications** in Millennium and restart Steam.

**From source:**

```bash
npm install
powershell -ExecutionPolicy Bypass -File dev.ps1 -Release
```

`-Release` builds and deploys under the plugin's real name (not a `-dev`
copy) and enables it. Steam restarts automatically unless you pass
`-NoRestart`.

## Settings

Open Millennium's sidebar and select **Enhanced Notifications**: pick a theme,
reload or open the themes folder, preview a notification, toggle style, sounds
and display time, or reset.

| Setting | What it does |
| --- | --- |
| Theme | Which theme to use |
| Reload themes | Pick up edits to a theme file without restarting Steam |
| Themes folder | Opens the folder for your own themes |
| Preview | Shows one of Steam's own test toasts, a different type each press |
| Themed style | Off: Steam's own look for every notification |
| Themed sounds | Off: Steam's own sounds. Steam's mute setting is always respected |
| Themed display time | Off: Steam's own display time per notification |
| Reset to defaults | Clears every changed setting |

## How to test

Five minutes, no game required:

1. Open the settings panel and press **Preview** a few times: each press
   shows a different notification type (downloads, clips, cloud sync,
   battery, updates), all restyled the same way.
2. Toggle **Themed style**, **Themed sounds** and **Themed display time** off
   and on; confirm Steam's own look/sound/timing comes back when off.
3. Edit `themes/steam_midnight.json` (or a copy in your themes folder), press
   **Reload themes**, then **Preview** again to see the change.
4. Switch between the desktop client and Big Picture Mode and preview in
   each: both should show the themed toast, in the theme's position.

## Themes

Themes are `.jsonc` (or `.json`) files: JSON with `//` comments and trailing commas allowed. Put your own in
`<Steam>/millennium/config/enhanced-notifications/themes/`. That folder
survives updates, and a theme there replaces a bundled one with the same name.
See [themes.md](themes.md) for the format and
[themes/steam_midnight.json](themes/steam_midnight.json) for an example.

## Known limitations

- Friend and message toasts depend on Steam's Friends notification settings —
  if Steam wouldn't show the toast, there's nothing for this plugin to style.
- The in-game overlay is not yet verified.
- Desktop toast frame is 284×71.
- Styling, sounds and display time do nothing while Steam's own toast
  notifications are turned off entirely (Steam Settings -> Notifications).
  The settings panel shows a warning when it can detect this.
- On Millennium v3.4.1 the Configuration API only partly works (settings save,
  but Millennium may log an error). The plugin works around it; you should
  never see a broken save.

## Troubleshooting

- **Styling, a sound or the display time misbehaves.** Each part can be switched off on its own: in the SharedJSContext console run
  `PLUGIN_LIST['enhanced-notifications'].setSetting('disabledFeatures', 'style,sound')`. Ids: `style`, `sound`, `duration`,
  `preview`. Steam's own look, sound or duration comes back for that part. Empty string switches everything back on.
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
