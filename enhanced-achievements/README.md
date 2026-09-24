# Enhanced Achievements

A [Millennium](https://steambrew.app/) plugin that themes Steam's achievement
notifications: a custom banner and sound for each rarity tier, from JSON themes
you can edit and share.

- **Four rarity tiers**: normal (bronze), magic (silver), rare (gold) and
  exceptional (the unlock that completes the game), chosen from Steam's own
  global unlock percentage.
- **Custom sound per tier**, replacing Steam's chime. Steam's "play a sound
  with notifications" setting is still respected.
- **Themed banner** with gradients, borders, glow, icons and animations, on the
  desktop client, in Big Picture, and in the in-game overlay.
- **Nothing breaks if something is wrong.** A missing sound falls back to
  Steam's chime, and a broken theme falls back to Steam's own toast.

Screenshots and clips on unlock are planned; the settings are visible but
disabled until then.

## Settings

Open Millennium's sidebar and select **Enhanced Achievements**:

| Setting | What it does |
| --- | --- |
| Theme | Which theme to use |
| Reload themes | Pick up edits to a theme file without restarting Steam |
| Open themes folder | Opens the folder for your own themes |
| Preview | Fires a test achievement for each tier |
| Themed banner / Themed sound | Turn each part off to get Steam's own toast or chime back |
| Reset to defaults | Clears every changed setting |

## Themes

A theme is one `.json` file plus the images and sounds it uses. The format is
documented in [themes.md](themes.md); [themes/steam_ps_exemple.json](themes/steam_ps_exemple.json)
is a full example.

Put your themes in `<Steam>/millennium/config/enhanced-achievements/themes/`
(**Open themes folder** takes you there). That folder survives plugin updates.
A theme there with the same name as a bundled one replaces it.

To share a theme, share its folder: the `.json` and an `assets/` folder, with
paths in the theme written relative to it (`"assets/gold.png"`).

The workflow is: edit the JSON, press **Reload themes**, press **Preview**.

## Limits

- **Banner size is Steam's.** Steam sizes and places the toast window itself
  (284×71 on the desktop client). A theme's `scale` enlarges text and icons
  within that frame, not the window. `position` follows Steam's own
  notification position setting.
- **Rarity needs Steam's data.** Games without global unlock percentages
  (including non-Steam games) always use the normal tier, except for the
  unlock that completes the game.

## Install

Copy the plugin folder into `<Steam>/millennium/plugins/`, enable it in
Millennium, and restart Steam.
