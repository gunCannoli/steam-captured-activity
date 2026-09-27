# Plan: Steam Cartridges Settings Redesign & Organization

**Status:** Ready for Execution  
**Reference Styling:** `enhanced-achievements/frontend/settings/settings-panel.tsx`  
**Parent Architecture:** [docs/millennium-architecture.md](../millennium-architecture.md) & [docs/steam-cartridges-achievements.md](../steam-cartridges-achievements.md)  
**Tracking:** [TASK.md](../../TASK.md)

---

## 1. Objectives & Overview

Reorganize the `steam-cartridges` settings panel into four clean, native-styled sections modeled after `enhanced-achievements`:

1. **`{Metadata}` Services**:
   - Manage and configure metadata providers:
     - **Steam Store Mirror**: Zero-friction native store mirroring (no creds required, active by default).
     - **ScreenScraper**: Configurable credentials (`screenscraper_user`, `screenscraper_pass`, `dev_user`, `dev_pw`).
     - **IGDB / Twitch**: Configurable credentials (`twitch_client_id`, `twitch_client_secret`).
   - "+ Add Service" button with inline/dialog service configuration.
   - Live status badges (`✓ Ready`, `⚠ Needs Credentials`).

2. **`{Achievements}` Sources**:
   - Manage and configure achievement providers:
     - **Steam Store Mirror & PC Emulators**: Goldberg, CODEX, RUNE, GSE saves + Unity/Godot/Unreal logs (zero creds required). Launch toast controls (`all_runs`, `first_run`, `off`).
     - **RetroAchievements**: Auto-discovered or manual credentials (`retroarch.cfg`, DuckStation, PCSX2, `.env`). Hardcore/Softcore toggle (`raHardcoreMode`).
     - **Console Emulators (RPCS3 / PS4 / etc.)**: Local trophy files (`TROPCONF.SFM`, `TROPUSR.DAT`) and emulator logs. Live detected emulator overview.
   - "+ Add Achievements Source" button & "Test Retro Toast" verification action.

3. **`{Rules}` Routing Engine**:
   - Replaces and generalizes legacy collection buckets into a flexible, multi-service routing engine.
   - Supports:
     - **Service Target**: `All Services`, `Steam Store Mirror`, `RetroAchievements`, `ScreenScraper`, `IGDB`, `RPCS3 Trophies`, `None (Disable)`.
     - **Action**: `Inclusion` ("Only apply this service to matching games") or `Exclusion` ("Never apply this service to matching games").
     - **Condition**: `Game Title` (substring/wildcard), `Collection Name` (Steam collection), `Regex Pattern` (against title or command line).
   - "+ Add Rule" button with intuitive dropdowns and live collection suggestions.
   - Up/Down priority reordering and deletion.

4. **`{Revision}` & Game Audit Center**:
   - Automatic health check and audit for all non-Steam shortcuts in the library:
     - Detects games with **Unknown Input Support** (no controller status inferred or mapped).
     - Detects games with **Missing Metadata** (no description, developer, or release date).
     - Detects games with **No Achievements / Weird Names** (unrecognized ROM filenames or missing schemas).
   - Summary counter badge: e.g. *"X games need review"*.
   - "Review & Fix" expandable list with quick 1-click remedies:
     - Override Controller Support: Full Controller / Partial / None.
     - Search & map Steam Store AppID.
     - Clean game title or set custom ROM hash.

---

## 2. Technical Design & File Modifications

### Backend (`steam-cartridges/backend/`)
- **`web_config.lua`**:
  - Add ScreenScraper credential fields (`screenscraper_user`, `screenscraper_pass`, `screenscraper_dev_user`, `screenscraper_dev_pw`).
  - Add `config.save_credentials(map)` to persist credentials safely into `<data_dir>/.env` without exposing secrets in logs.
- **`web_rpc.lua` & `main.lua`**:
  - Add `SaveServiceCredentials(payload_json)` RPC method.
  - Add `GetServiceStatus(payload_json)` returning sanitized status for all 5 services: Steam Store, ScreenScraper, IGDB, RetroAchievements, and RPCS3.

### Frontend (`steam-cartridges/frontend/`)
- **`settings/settings.ts`**:
  - Add `RoutingRule` interface: `{ id, name, service, action, conditionType, pattern }`.
  - Add `routingRules: RoutingRule[]` setting (migrates from `buckets.rules` seamlessly).
  - Add `controllerOverrides: Record<string, 'full' | 'partial' | 'none' | 'auto'>`.
  - Add `servicesConfig: Record<string, boolean>`.
- **`features/buckets/resolve.ts`**:
  - Update resolution logic so that `routingRules` evaluates `service`, `action`, `conditionType`, and `pattern` with full backward compatibility for existing collection rules.
- **`settings/settings-panel.tsx`**:
  - Refactor using `enhanced-achievements` styling components:
    - `PanelSection`, `PanelSectionRow`, `ItemRow`, `Field`, `DialogButton`, `SteamToggle`, `Dropdown`, `DialogBodyText`.
  - Implement 4 dedicated modular components:
    1. `<MetadataSection />`: Services list, status badges, "+ Add Service" credential modal/card.
    2. `<AchievementsSection />`: Steam Store, RetroAchievements, Emulators, "+ Add Source", and "Test Toast" button.
    3. `<RulesSection />`: Rules list, "+ Add Rule" interactive builder with live collection/game suggestions, priority controls.
    4. `<RevisionSection />`: Audit counter, issue badges, "Review & Fix" table with inline 1-click fixes for controller, metadata, and titles.

---

## 3. Verification Plan

1. **Type & Unit Tests**:
   - `npm run check` (`tsc --noEmit`): Verify 0 TypeScript errors.
   - `npm run test:ts`: Verify existing 54 tests pass and add new tests for routing rule evaluation.
2. **Build & Live Deployment**:
   - `npm run build` in `steam-cartridges/`.
   - Deploy to `-dev` plugin via `dev.ps1` and restart Steam in Big Picture mode (`start-steam-dev.ps1 -BigPicture`).
3. **Live CDP Verification**:
   - Open Steam Settings -> Steam Cartridges.
   - Verify all 4 sections render with native `enhanced-achievements` panel styling.
   - Test adding a rule (e.g. Include RetroAchievements for collection "Emulation").
   - Test "+ Add Service" credential save.
   - Test "Review & Fix" audit list and verify applying a controller override immediately reflects on the shortcut.
   - Run `check_all_tabs.js` multi-tab smoke test to guarantee 0 regressions across Post-Game Summary, Activity feed, Your Stuff, and Game Info.
