# Example themes

These are reference themes, not bundled with the plugin (`dev.ps1` does not
deploy this folder, and the backend does not list it as a theme source). They
show the `achievements` block: the themed banner per rarity tier
([themes.md § achievements](../themes.md#achievements)).

- `theme_exemple.json`: minimal example, one icon and one sound per tier.
- `../tests/fixtures/tiered_theme.json` (a test fixture): a fuller example with
  its own icon set and sound per tier.

To use one: bring your own assets (images/sounds referenced by the theme),
then copy the `.json` and your `assets/` folder into
`<Steam>/millennium/config/enhanced-notifications/themes/` (the plugin's
**Open themes folder** button takes you there) and pick it in the settings
panel.
