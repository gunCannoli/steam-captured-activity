# Steam Cartridges - Local Emulators

An extension for steam-cartridges. It finds the achievements a non-Steam game saved through
a Steam API emulator, or wrote to its engine log, and hands them to steam-cartridges, which shows them on the game's Steam
page, as Steam's own unlock toast, and in the Post-Game Summary.

## What it reads

| Source | Files |
| --- | --- |
| CODEX, RUNE, RELOADED, GSE, SkidRow, EMPRESS | `achievements.ini` (section per achievement, or an `[Achievements]` map), `[SteamAchievements]` lists |
| SOVEREIGN | `SOVEREIGN.ini` next to the game or under `%APPDATA%\SOVEREIGN` |
| Goldberg / GSE | `achievements.json` (array or object form) |
| Online-Fix | `Stats\achievements.ini` (its `Stats.ini` holds progress only and is never read as unlocks) |
| Tenoke | `user_stats.ini`, `SteamData\user_stats.ini`; the AppID from `tenoke.ini` |
| SmartSteamEmu | `achievements.ini`, `stats.bin` (read only) |
| UniverseLAN | `UniverseLANData\Achievements.ini`; the AppID from `UniverseLAN.ini` |
| Unity, Godot, Unreal games | `Player.log`, `godot.log`, `Saved\Logs\*.log` |

Files are found in the game's own folder (walking up from its executable) and in the emulators' usual save folders
under `%PUBLIC%\Documents`, `%APPDATA%` and `%LOCALAPPDATA%`, for the Steam app the shortcut is mapped to in
steam-cartridges and for any AppID the game folder names (`steam_appid.txt`, `SOVEREIGN.ini`, `UniverseLAN.ini`,
`tenoke.ini`). UTF-8 and UTF-16 files, with or without a BOM, are read.

## While you play

With **Watch while a game runs** on (Settings, steam-cartridges, Local achievements), the files are checked every
2 seconds while the game runs, and an unlock shows at once. Unlocks already in the files when the game starts are
recorded without a toast.

## Reset

steam-cartridges' Reset Achievements dialog lists these files as one source. Each file is copied to
`<file>.bak-<time>` before its unlocks are cleared, in its own encoding; `stats.bin` is never changed.

## Install

Requires steam-cartridges 1.1.0 or later (its extension API). Install both plugins in Millennium and enable them.

## Credits

File-format and folder-layout knowledge from [PSerban93/Achievements](https://github.com/PSerban93/Achievements)
(MIT License, © 2025 JokerVerse).
