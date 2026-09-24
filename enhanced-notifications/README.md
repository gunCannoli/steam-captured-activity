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

## Settings

Open Millennium's sidebar and select **Enhanced Notifications**: pick a theme,
reload or open the themes folder, preview each category, toggle style, sounds
and display time, or reset.

## Themes

Themes are JSON files. Put your own in
`<Steam>/millennium/config/enhanced-notifications/themes/`. That folder
survives updates, and a theme there replaces a bundled one with the same name.
See [themes.md](themes.md) for the format and
[themes/steam_midnight.json](themes/steam_midnight.json) for an example.

Resolution order: `default` → category (`friends`, `messages`, `downloads`,
`recording`, `achievement`, `system`) → type (Steam's own names, e.g.
`FriendOnline`, `DownloadComplete`, `CloudSyncFailure`).

## Limits

- Friend and message previews only appear if Steam's Friends notification
  settings allow those toasts.
- Big Picture and the in-game overlay are not yet verified.
