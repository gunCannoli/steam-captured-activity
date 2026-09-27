# Plan: Retro Games & Emulators Achievements in steam-cartridges

**Status:** Plan Complete · Execution Ready  
**Reference Architecture:** [docs/steam-cartridges-retrogames-achievements.md](../steam-cartridges-retrogames-achievements.md)  
**Parent Architecture:** [docs/steam-cartridges-achievements.md](../steam-cartridges-achievements.md)  
**Tracking:** [TASK.md](../../TASK.md)

---

## 1. Context & Objectives

Our initial implementation verified:
- Zero-friction credential reading from `C:\emu\RetroArch\retroarch.cfg`.
- SNES ROM hashing with SMC header stripping and zip deflation (`fa1aca99...` / `cdd3c8c3...`).
- RetroAchievements schema and user unlock ingestion into `achievements.json`.
- Out-of-process real-time log observer detecting `[INFO] [RCHEEVOS] Awarded achievement <ID>`.
- Live Big Picture individual achievements screen rendering 149 achievements for *Super Mario World*.

This plan expands that backbone to full coverage across:
1. **Multi-Console Hashing:** N64 endian normalization, NES iNES header strip, Genesis SMD de-interleaving, `.m3u` playlist unwrapping, and PS1/PS2 ISO-9660 `SYSTEM.CNF` boot binary extraction.
2. **Standalone Emulators:** Automatic discovery of DuckStation, PCSX2, Dolphin, and PPSSPP configs and log tailers.
3. **Console Trophies (RPCS3):** Local PlayStation 3 trophy schema (`TROPCONF.SFM`) and unlock file (`TROPUSR.DAT`) parsing.
4. **Settings Panel UI:** Detected emulators status, Hardcore/Softcore display toggles, test notification action.

---

## 2. Preconditions

Before beginning implementation of any step:
1. Working tree is clean: `git status` reports no untracked or unstaged changes.
2. TypeScript build is clean: `npm run check` in `steam-cartridges/` exits with code 0.
3. Frontend bundles cleanly: `npm run build` in `steam-cartridges/` exits with code 0.
4. Live Steam client is running on port 8080 (`http://127.0.0.1:8080`).

---

## 3. Ordered Implementation Steps

### Step 1: Expand ROM & Disc Hasher (`backend/ra_hasher.js`)
- **File:** `steam-cartridges/backend/ra_hasher.js`
- **Actions:**
  - Add N64 magic-byte detection (`0x80371240` big-endian, `0x37804012` byte-swapped, `0x40123780` little-endian) and normalize byte arrays to big-endian before MD5.
  - Add NES iNES 16-byte header check (`NES\x1a`) and slice off header.
  - Add Genesis SMD 512-byte header detection and 16KB block de-interleaving.
  - Add `.m3u` file detection: parse first line, resolve target file relative to `.m3u` directory, and hash target.
  - Add PS1/PS2 ISO-9660 sector 16 PVD parser: read `SYSTEM.CNF`, extract boot executable filename, and hash that file's byte stream.
- **Verification Command:** `node scratch/test_ra_hash.mjs` against SNES, N64, and PS1 test fixtures.

### Step 2: Multi-Emulator Discovery & Log Observer
- **Files:**
  - `steam-cartridges/backend/retroachievements.lua`
  - `steam-cartridges/backend/achievements_observer.lua`
- **Actions:**
  - In `retroachievements.lua`: Add candidate search paths for DuckStation (`settings.ini`), PCSX2 (`inis/PCSX2.ini`), and Dolphin (`Dolphin.ini`). Read credentials from `[Achievements]` section if `retroarch.cfg` is absent or unconfigured.
  - In `achievements_observer.lua`: Add active log candidates for DuckStation (`duckstation.log`), PCSX2 (`emulog.txt`), and Dolphin (`dolphin.log`).
- **Verification Command:** `node scratch/test_ra_observer.mjs` with simulated logs.

### Step 3: RPCS3 Local Trophy Provider
- **Files:**
  - `steam-cartridges/backend/ps3_trophies.lua` (New)
  - `steam-cartridges/backend/achievements_rpc.lua`
- **Actions:**
  - Implement XML parser for `TROPCONF.SFM` (Trophy ID, title, description, type, hidden flag).
  - Implement binary parser for `TROPUSR.DAT` (32-byte record stride, 64-bit Unix timestamp).
  - Register RPC fallback in `achievements_rpc.lua` for RPCS3 shortcuts.
- **Verification Command:** Node verification against sample RPCS3 trophy directory.

### Step 4: Settings Panel & Hardcore/Softcore Toggle
- **Files:**
  - `steam-cartridges/frontend/features/settings/settings.ts`
  - `steam-cartridges/frontend/features/settings/settings-panel.tsx`
- **Actions:**
  - Add `raHardcoreMode: boolean` setting (default: true).
  - Add `SettingsPanel` table displaying detected emulators and authentication usernames.
  - Add "Test Retro Toast" button dispatching `cartridges:trigger_fake_achievement`.
- **Verification Command:** `npm run check` && `npm run build`.

---

## 4. Banned Actions
- Do NOT reload `SharedJSContext` via `location.reload()` or DevTools reload.
- Do NOT inject DLLs, create remote threads, or touch emulator memory.
- Do NOT commit `cheevos_token` or credentials to git or documentation.
- Do NOT build custom HTML replacements for Steam's native achievement pages.
- Do NOT add AI attribution trailers (`Co-Authored-By`, `Generated with...`) to git commits.

---

## 5. Live Verification
1. Run `node scratch/check_all_tabs.js` against target shortcut: all 4 tabs PASS.
2. Run `node scratch/test_nav_cycle.js`: two-way navigation lifecycle maintains achievement states.
3. Big Picture navigation to `/routes/library/app/<shortcut_appid>/achievements/my/individual` displays genuine badge images and completion percentage.
