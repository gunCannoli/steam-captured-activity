# steam-cartridges Retro Games & Emulators Achievements Architecture & Plan

**Status:** Architecture Specification & Multi-Session Implementation Plan  
**Target Plugin:** `steam-cartridges` (Phase 5 Extension)  
**Parent Document:** [docs/steam-cartridges-achievements.md](steam-cartridges-achievements.md)  
**Core Invariant:** Zero DLL injection, zero third-party storefront APIs, keyless zero-friction credentials, out-of-process observation, native Steam UI integration.

---

## 1. Executive Summary & Vision

Steam has never natively supported achievements for retro games launched through emulators (RetroArch, DuckStation, PCSX2, RPCS3, Dolphin, PPSSPP). Millions of players manage rich non-Steam retro libraries via Steam shortcuts (using Steam ROM Manager, BoilR, or manual entry), but their app pages show grey warnings, zero progress, and no achievement tracking.

Meanwhile, [RetroAchievements.org](https://retroachievements.org) hosts over 300,000 community achievements across thousands of games spanning 40+ classic console architectures, and standalone emulators like RPCS3 maintain local PlayStation 3 trophy files on disk.

This document defines the complete architecture and phased implementation plan to bring **native Steam achievements** to retro games:
1. **Zero User Configuration:** Automatically reads active credentials (`cheevos_username` and `cheevos_token`) from the player's installed emulators (e.g. `retroarch.cfg`, `duckstation.ini`, `PCSX2.ini`). No API keys, no passwords to type, and no secrets committed.
2. **Intelligent Multi-Console Hashing:** Resolves ROMs, compressed archives (`.zip`), and multi-disc formats (`.chd`, `.iso`, `.cue`/`.bin`, `.m3u`), performing copier header stripping, endian byte-swapping, and disc executable extraction out-of-process.
3. **Genuine Steam UI Integration:** Feeds Steam's native achievement stores (`AppDetailsStore`, `AchievementsFullStore`, `appAchievementProgressCache`, `appSpotlightStore`), rendering official badge artwork, rarity tiers, and descriptions on desktop and Big Picture Mode.
4. **Zero-Lag Native Toasts:** Out-of-process log tailing and file watchers detect unlock events in real time without injecting code into emulator processes, triggering genuine Steam toasts and sound chimes (and theming with `enhanced-achievements`).
5. **Console Trophy Support (RPCS3):** Decrypts and reads local PS3 trophy files (`TROPUSR.DAT`, `TROPCONF.SFM`) to display native PlayStation trophies as Steam achievements.

---

## 2. System Architecture & Topology

```
+---------------------------------------------------------------------------------------------------+
|                                     NON-STEAM SHORTCUT ENTRY                                      |
|            e.g. "retroarch.exe -L cores\snes9x_libretro.dll C:\roms\Super Mario World.zip"         |
|                 "duckstation-qt.exe -batch -fullscreen C:\roms\Crash Bandicoot.chd"               |
|                 "rpcs3.exe --no-gui C:\games\Persona 5\PS3_GAME\USRDIR\EBOOT.BIN"                 |
+-------------------------------------------------+-------------------------------------------------+
                                                  │
                                                  ▼
+---------------------------------------------------------------------------------------------------+
|                                SHORTCUT & CREDENTIAL RESOLVER                                     |
|  - Identifies Emulator Engine: RetroArch | DuckStation | PCSX2 | RPCS3 | Dolphin | PPSSPP         |
|  - Discovers Local Config: retroarch.cfg | duckstation.ini | PCSX2.ini | rpcs3.ini                |
|  - Auto-reads: cheevos_username, cheevos_token (or RPCS3 local trophy directory)                  |
|  - Dereferences: .m3u playlists, relative paths, wrapped quotes                                   |
+-------------------------------------------------+-------------------------------------------------+
                                                  │
                                                  ▼
+---------------------------------------------------------------------------------------------------+
|                                 UNIVERSAL ROM & DISC HASHER                                       |
|  - ra_hasher.js / disc_hasher.js:                                                                |
|    * SNES: Strip 512b copier/SMC header                                                           |
|    * N64: Endian-normalize (.v64/.n64 -> .z64 big-endian)                                         |
|    * NES: Strip 16b iNES header (PRG/CHR hashing)                                                 |
|    * Genesis: SMD 512b header stripping & block de-interleaving                                   |
|    * PS1 / PS2: ISO/CHD volume descriptor parsing; hashes SYSTEM.CNF boot executable              |
|    * Zip: In-memory stream deflation (no disk extraction)                                         |
|  - Resolves Canonical GameID from RetroAchievements (dorequest.php?r=gameid&m=<md5>)             |
|    (or reads RPCS3 TitleID: NPWR01234_00)                                                         |
+-------------------------------------------------+-------------------------------------------------+
                                                  │
                                                  ▼
+---------------------------------------------------------------------------------------------------+
|                                SCHEMA INGESTION & CACHING                                         |
|  - Fetches patch data (titles, descriptions, badges, points, global rarities) & user unlocks      |
|  - Saves to <steam>/millennium/config/steam-cartridges/achievements.json:                         |
|    * Schemas: schemas["ra_<GameID>"] or schemas["ps3_<TitleID>"]                                  |
|    * Shortcuts: shortcuts["<shortcutAppId>"].schema_appid = "ra_<GameID>"                         |
+-------------------------------------------------+-------------------------------------------------+
                                                  │
                         ┌────────────────────────┴────────────────────────┐
                         ▼                                                 ▼
+------------------------------------------------+ +------------------------------------------------+
|          REAL-TIME IN-GAME OBSERVERS           | |               STEAM NATIVE SINKS               |
|                                                | |                                                |
| 1. RetroArch Observer:                         | | 1. NotificationStore.OnNotification            |
|    Tails C:\emu\RetroArch\logs\retroarch.log   | |    Genuine native toast + audio chime 5        |
|    Pattern: [RCHEEVOS] Awarded achievement <ID>| | 2. Big Picture Full-Screen Screen              |
| 2. DuckStation / PCSX2 Observer:               | |    AchievementsFullStore prototype hook         |
|    Tails duckstation.log / emulog.txt          | | 3. Desktop Library Right Column                |
| 3. RPCS3 Local Trophy Observer:                | |    AppDetailsStore.GetAchievements hook        |
|    Watches TROPUSR.DAT / Tails trophy.log      | | 4. Big Picture Play Bar Progress                |
| 4. Offline Sync & Replay Engine                | |    appAchievementProgressCache.set()           |
+------------------------------------------------+ +------------------------------------------------+
```

---

## 3. Detailed Technical Evaluation: What Was Missing

Our initial Phase 5 spike verified RetroArch SNES ROM hashing, schema ingestion, and log tailing against *Super Mario World*. However, broad support for the entire retro library requires resolving several architectural gaps:

| Component | Current State (Initial Spike) | Required State (Comprehensive Support) |
| --- | --- | --- |
| **ROM Formats** | SNES SMC header strip & simple `.zip` deflation only | Endian normalization (N64), iNES header strip (NES), SMD de-interleaving (Genesis), multi-disc `.m3u` unwrapping |
| **Disc Images (PS1/PS2)** | Missing (hashes whole file, fails on 700MB `.bin`/`.iso`/`.chd`) | ISO/CHD/CUE parser: parses primary volume descriptor, extracts `SYSTEM.CNF`, hashes main executable binary |
| **Standalone Emulators** | RetroArch only | DuckStation (PS1), PCSX2 (PS2), Dolphin (GameCube), PPSSPP (PSP) credential and log discovery |
| **PS3 Trophies (RPCS3)** | Missing | Local decryption of `TROPCONF.SFM` XML schema and `TROPUSR.DAT` unlock timestamps without network |
| **Emulator Config Parsing** | Single hardcoded `C:\emu\RetroArch` path | Multi-candidate discovery across `%APPDATA%`, `%LOCALAPPDATA%`, `%USERPROFILE%`, and custom Steam paths |
| **Logger Invariant** | Assumes `log_to_file = "true"` | Verifies emulator logging state; provides UI warning or one-click auto-configuration if disabled |
| **Scoring & Mode** | Unlocks mapped to raw points | Support for Hardcore vs Softcore badges, total retro score counter, and rarity percentile calculation |
| **Offline Sync** | Ingests at view time | Background offline unlock reconciliation when re-connecting or relaunching Steam |

---

## 4. Multi-Console ROM & Disc Hashing Specification

RetroAchievements hashes target the **original game program code**, not random header padding or disc container wrappers. `backend/ra_hasher.js` must be expanded into a modular hasher engine.

### 4.1 Cartridge Systems

#### Super Nintendo (SNES)
- **Header:** 512-byte copier header added by old dumpers (Super Magicom / SMC).
- **Rule:** If `fileSize % 1024 == 512`, slice off the first 512 bytes: `bytes = bytes.subarray(512)`.
- **Hash:** `MD5(bytes)`.

#### Nintendo 64 (N64)
- **Problem:** Dumps exist in three endian formats:
  - `.z64`: Big-Endian (ABCD) - The native N64 format and RetroAchievements standard. Magic bytes: `0x80 0x37 0x12 0x40`.
  - `.v64`: Byte-Swapped (BADC) - Magic bytes: `0x37 0x80 0x40 0x12`.
  - `.n64`: Little-Endian (DCBA) - Magic bytes: `0x40 0x12 0x37 0x80`.
- **Rule:** Read the first 4 bytes to detect endianness. If `.v64`, swap every 2-byte word (`[0,1] -> [1,0]`). If `.n64`, swap every 4-byte word (`[0,1,2,3] -> [3,2,1,0]`).
- **Hash:** `MD5(normalized_z64_bytes)`.

#### Nintendo Entertainment System (NES)
- **Header:** 16-byte iNES header (`NES<EOF>`).
- **Rule:** For PRG/CHR ROM matching, strip the first 16 bytes: `bytes = bytes.subarray(16)`.
- **Hash:** `MD5(bytes)`.

#### Sega Mega Drive / Genesis
- **Header:** Some dumps use `.smd` (Super Magic Drive) format, which prepends a 512-byte header and interleaves the 16K blocks into split even/odd bytes.
- **Rule:** If format is SMD, strip the 512-byte header and de-interleave the 16KB blocks into sequential bytes.
- **Hash:** `MD5(deinterleaved_bytes)`.

---

### 4.2 Disc-Based Systems (PS1 & PS2)

Disc images are typically 400MB to 4.7GB. RetroAchievements **never** hashes the raw disc image. Instead, it extracts the target executable.

#### The ISO-9660 & Primary Volume Descriptor (PVD) Algorithm
1. Read Sector 16 (offset `16 * 2048 = 0x8000` for standard ISO, or `16 * 2352 + 24` for RAW 2352-byte CUE/BIN sectors).
2. Verify the PVD signature `0x01, "CD001"`.
3. Locate the Root Directory Record to read the disc directory table.
4. Read the text file `SYSTEM.CNF` at the root of the disc:
   ```ini
   BOOT = cdrom:\SLUS_000.67;1
   VER = 1.00
   VMODE = NTSC
   ```
5. Extract the boot executable filename (e.g. `SLUS_000.67`).
6. Locate that file entry in the ISO directory table and extract its data bytes into memory.
7. Compute `MD5(executable_bytes)`.
8. Query `dorequest.php?r=gameid&m=<executable_md5>`.

#### Disc Container Support
- **Raw `.iso` / `.bin`:** Direct sector seeks (no decompression needed).
- **`.chd` (MAME Compressed Hunks of Data):** Use standard CHD header v1-v5 parsing to read the hunk map, or invoke `chdman.exe extractcd` stream pipe for the first 100 sectors.
- **Multi-disc `.m3u` Playlists:** Parse the `.m3u` text, resolve the first listed disc path relative to the `.m3u` file, and hash Disc 1.

---

## 5. Emulator Discovery & Credential Matrix

`steam-cartridges` automatically discovers installed emulators and reads active credentials without prompting the user.

| Emulator | Config Location Candidates | Credential Keys | Active Log Path | Trigger Signature |
| --- | --- | --- | --- | --- |
| **RetroArch** | `C:\emu\RetroArch\retroarch.cfg`<br>`%APPDATA%\RetroArch\retroarch.cfg` | `cheevos_username`<br>`cheevos_token` | `logs\retroarch.log` | `[INFO] [RCHEEVOS] Awarded achievement <ID>: "<Title>"` |
| **DuckStation** | `%DOCUMENTS%\DuckStation\settings.ini`<br>`%APPDATA%\DuckStation\settings.ini`<br>`C:\emu\DuckStation\settings.ini` | `[Achievements]`<br>`Username = ...`<br>`Token = ...` | `duckstation.log` | `Awarded achievement <ID>` or `Achievement <ID> unlocked` |
| **PCSX2** | `%DOCUMENTS%\PCSX2\inis\PCSX2.ini`<br>`%APPDATA%\PCSX2\inis\PCSX2.ini`<br>`C:\emu\PCSX2\inis\PCSX2.ini` | `[Achievements]`<br>`Username = ...`<br>`Token = ...` | `emulog.txt` / `logs\PCSX2.log` | `[Achievements] Unlocked <ID>` |
| **RPCS3** | `C:\emu\RPCS3\`<br>`%APPDATA%\rpcs3\` | *Local Trophies*<br>(No login needed) | `trophy_data\NPWR<ID>_00\TROPUSR.DAT`<br>`RPCS3.log` | `[Trophy] Trophy Unlocked: <ID>` |
| **Dolphin** | `%APPDATA%\Dolphin Emulator\Config\Dolphin.ini`<br>`%USERPROFILE%\Documents\Dolphin Emulator\Config\Dolphin.ini` | `[Achievements]`<br>`Username = ...`<br>`Token = ...` | `Logs\dolphin.log` | `[Achievements] Awarded <ID>` |
| **PPSSPP** | `%APPDATA%\PPSSPP\PSP\SYSTEM\ppsspp.ini`<br>`C:\emu\PPSSPP\memstick\PSP\SYSTEM\ppsspp.ini` | `[Achievements]`<br>`UserName = ...`<br>`UserToken = ...` | `ppsspp.log` | `Achievement <ID> unlocked` |

---

## 6. RPCS3 Local PlayStation 3 Trophies Integration

PlayStation 3 emulation via RPCS3 provides a unique opportunity: PS3 games have rich, official Sony trophy schemas built directly into the game directory, and RPCS3 records player unlocks locally on disk.

### 6.1 Schema Extraction (Offline)
For any PS3 shortcut (`rpcs3.exe ... "<game_path>\USRDIR\EBOOT.BIN"`):
1. Navigate up to `<game_path>\TROPDIR\NPWR<TitleID>_00\`.
2. Parse `TROPCONF.SFM`: A standard XML file containing:
   - Trophy ID (e.g. `001`, `002`)
   - Trophy Type (`platinum`, `gold`, `silver`, `bronze`)
   - Trophy Title & Description
   - Hidden flag (`yes` / `no`)
3. Extract Trophy Badges: Local PNG images stored at `TROPDIR\NPWR<TitleID>_00\TROP<ID>.PNG`.
4. Mirror into `achievements_store`:
   - Store under schema key `"ps3_<TitleID>"`.
   - Set rarity percentages based on trophy type: Platinum (5%), Gold (15%), Silver (30%), Bronze (60%).

### 6.2 Unlock Detection (Real-Time)
- **Method A (Log Tailer):** Monitor `RPCS3.log` for:
  ```text
  ·E {Trophy} Trophy Unlocked: NPWR01234_00 [0] (Trophy Name)
  ```
- **Method B (File Watcher):** RPCS3 updates `<RPCS3_DIR>\trophy_data\NPWR<TitleID>_00\TROPUSR.DAT` whenever a trophy is earned.
  - File format: Fixed-header binary file containing 32-byte records for each trophy with a 64-bit Unix timestamp of when the trophy was unlocked.
  - The watcher detects file modification, diffs newly unlocked trophy IDs, and triggers native Steam toasts.

---

## 7. Phased Implementation Roadmap

### Phase 1: Modular ROM & Disc Hasher (`backend/ra_hasher.js`)
- [ ] Implement N64 endian detection & `.z64` normalization.
- [ ] Implement NES iNES 16-byte header stripping.
- [ ] Implement Genesis SMD header stripping & de-interleaving.
- [ ] Implement `.m3u` playlist resolver (follows path to Disc 1).
- [ ] Implement PS1/PS2 ISO-9660 PVD reader and `SYSTEM.CNF` boot executable extractor.
- [ ] Add hermetic Node unit tests in `steam-cartridges/tests/ra_hasher.test.ts`.

### Phase 2: Multi-Emulator Discovery & Standalone Observer
- [ ] Build `backend/emulator_detector.lua`: Scans shortcuts for emulator signatures (`duckstation`, `pcsx2`, `rpcs3`, `dolphin`, `ppsspp`, `retroarch`).
- [ ] Implement config parsers for DuckStation (`settings.ini`), PCSX2 (`PCSX2.ini`), and Dolphin (`Dolphin.ini`).
- [ ] Update `backend/achievements_observer.lua` to tail the discovered active emulator log.
- [ ] Verify live against standalone DuckStation and PCSX2 shortcuts.

### Phase 3: RPCS3 Local Trophy Provider
- [ ] Implement `backend/ps3_trophies.lua`:
  - Parses `TROPCONF.SFM` XML schema.
  - Serves local trophy PNG icons via Millennium data protocol.
  - Reads `TROPUSR.DAT` binary unlock timestamps.
- [ ] Hook into `achievements_rpc.lua` to route PS3 shortcuts to the local trophy store.
- [ ] Add real-time log observer for `RPCS3.log`.
- [ ] Verify live against a PS3 shortcut in Big Picture Mode.

### Phase 4: Plugin Settings & UI Controls
- [ ] Add "Retro & Emulator Achievements" section to `steam-cartridges` Settings panel:
  - Display detected emulators and authentication status (e.g. `RetroArch: Logged in as gunCannoli`, `DuckStation: Configured`, `RPCS3: Found`).
  - Toggle: Hardcore Mode vs Softcore Mode display.
  - Action button: "Test Retro Achievement Toast" (verifies audio chime 5 + popup).
  - Manual override field for RetroAchievements username and token (for setups without RetroArch).

---

## 8. Guardrail & Regression Checklist

When implementing changes for this plan, all engineers must verify:

1. **Guardrail 1 (Never inject into processes):** Emulators run completely unhooked. All observation is passive file tailing and config inspection.
2. **Guardrail 2 (No secrets in repo or docs):** Tokens are read dynamically from local configs. Never log `cheevos_token` in console output or save in git.
3. **Guardrail 3 (Steam Native Sinks):** Never build custom HTML overlays or replacement pages. Always feed `AchievementsFullStore`, `AppDetailsStore`, and `NotificationStore`.
4. **Guardrail 4 (Routine 1 Smoke Verification):** Every change must maintain:
   - Post-Game Summary hero banner
   - Activity feed daily cards (`hasEvent: true`)
   - Your Stuff tab media captures
   - Game Info tab without error boundaries
5. **Guardrail 5 (Routine 2 Two-Way Navigation):** Game A (Retro) $\to$ Game B (Native) $\to$ Game A (Retro) must preserve all achievement counts and UI integrity.
6. **Guardrail 6 (Routine 6 Attribution Policy):** No AI attribution trailers (`Co-Authored-By`, `Generated with...`) in git commits.

---

## 9. Verification & Test Suite

### 9.1 Hermetic Tests
- `npm run test:ts` in `steam-cartridges/`: Tests hasher algorithms with synthetic binary fixtures (SNES SMC header, N64 byte-swapped, NES iNES, ISO PVD).
- `test_backend.lua`: Tests emulator config parsing and shortcut ROM path extraction.

### 9.2 Automated CDP Verification
- `scratch/test_ra_observer.mjs`: Tests incremental log tailing against simulated RetroArch output.
- `scratch/check_bpm_images.mjs`: Verifies that Big Picture Mode renders RetroAchievements badge PNGs without HTTP 403/404 errors.
- `scratch/test_nav_cycle.js`: Verifies two-way navigation lifecycle across Steam tabs.
