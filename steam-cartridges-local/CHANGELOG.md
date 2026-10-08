# Changelog

## [0.2.0] - 2026-10-08

### Added
- Watches a running game's achievement files and engine logs (every 2 s) and pushes new unlocks to steam-cartridges,
  which shows Steam's toast; unlocks already present at launch are recorded silently (ADR-0063).
- Tenoke `user_stats.ini`, Online-Fix `Stats\achievements.ini`, SmartSteamEmu `stats.bin`, hex `State`/`Time` INI
  sections, `[SteamAchievements]` lists, UTF-16 files without a BOM.
- AppID discovery in the game folder: `steam_appid.txt`, `UniverseLAN.ini`, `tenoke.ini`, `SOVEREIGN.ini`.
- Unity, Godot and Unreal engine logs (moved from steam-cartridges); a log seen for the first time is read from its end.
- Settings: "Watch while a game runs".

### Changed
- An unlock whose time is unknown is reported with time 0 (steam-cartridges records it at the time it sees it).
- Reset writes a UTF-16 file back as UTF-16.
- The file search uses what steam-cartridges passes (exe, mapped app); it no longer reads Steam's shortcut list or
  steam-cartridges' files, and no path or user id is hardcoded.

### Fixed
- Online-Fix `Stats.ini` (progress only) was treated as an unlock file.
- Tenoke files were never read.
- UTF-16 files lost every non-ASCII character.

## [0.1.0] - 2026-10-06

- First version: CODEX, RUNE, GSE, Goldberg and SOVEREIGN files, reset with backups.
