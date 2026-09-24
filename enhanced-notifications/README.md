# Enhanced Notifications

A [Millennium](https://steambrew.app/) plugin that restyles **every** Steam
notification (friends, messages, downloads, recordings, system, achievements)
from shareable JSON themes. It keeps Steam's own icons, logos and text, and
changes only how they look and sound:

- popup background (solid or gradient), border, glow, Steam-logo watermark
- font, title, body and subtext colours, sizes and weights
- app-logo corner radius and visibility, header icon
- sound per type or category (custom file, or `false` to mute)
- display time per type

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
reload or open the themes folder, preview each category, toggle style, sounds
and display time, or reset.

| Setting | What it does |
| --- | --- |
| Theme | Which theme to use |
| Reload themes | Pick up edits to a theme file without restarting Steam |
| Open themes folder | Opens the folder for your own themes |
| Preview | Fires a real Steam test toast for each category |
| Themed style | Off: Steam's own look for every notification |
| Themed sounds | Off: Steam's own sounds. Steam's mute setting is always respected |
| Themed display time | Off: Steam's own display time per notification |
| Reset to defaults | Clears every changed setting |

## How to test

Five minutes, no game required:

1. Open the settings panel and press **Preview** for each category
   (friends, messages, downloads, recording, achievements, system) — a
   restyled toast should appear (friends/messages only if Steam's Friends
   notification settings allow those toasts).
2. Toggle **Themed style**, **Themed sounds** and **Themed display time** off
   and on; confirm Steam's own look/sound/timing comes back when off.
3. Edit `themes/steam_midnight.json` (or a copy in your themes folder), press
   **Reload themes**, then **Preview** again to see the change.
4. Switch between the desktop client and Big Picture Mode and preview a
   category in each — both should show the themed toast.

## Themes

Themes are JSON files. Put your own in
`<Steam>/millennium/config/enhanced-notifications/themes/`. That folder
survives updates, and a theme there replaces a bundled one with the same name.
See [themes.md](themes.md) for the format and
[themes/steam_midnight.json](themes/steam_midnight.json) for an example.

Resolution order: `default` → category (`friends`, `messages`, `downloads`,
`recording`, `achievement`, `system`) → type (Steam's own names, e.g.
`FriendOnline`, `DownloadComplete`, `CloudSyncFailure`).

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

## Uninstall

Disable **Enhanced Notifications** in Millennium's plugin list, then delete
`<Steam>/millennium/plugins/enhanced-notifications` (and, if you used
dev.ps1's default deploy, `enhanced-notifications-dev`). Your themes in
`<Steam>/millennium/config/enhanced-notifications/` are left in place.
