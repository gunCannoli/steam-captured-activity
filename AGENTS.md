# AGENTS.md

Guidance and standard operating procedures for AI agents working in this repository.

## What this repo is

A workspace for building **Millennium** plugins (Steam Client homebrew mods).

The product is a **core plugin plus optional provider plugins**:

- **`non-steam-games-activity`** (the backbone) — gives **any** non-Steam game
  Steam's own rich app detail page, using only data Steam already has: the
  screenshots and recordings Steam itself captured. It does not rebuild that
  page — Steam hides it from shortcuts by app type, so the plugin restores the
  section and feeds Steam's own store. No emulator, no network, no API key.
- **Providers** — optional plugins that enrich the timeline for games they recognise:
  `retroachievements`, `retroarch`, guides, artwork, and so on.

The core must be useful alone and must never depend on a provider. See
[docs/architecture.md](docs/architecture.md).

## Read this before writing code

| Doc                                                      | What it holds                                                                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [TASK.md](TASK.md)                                       | **Start here** — current status, multi-session roadmap, what is next                                                        |
| [CHANGELOG.md](CHANGELOG.md)                             | **Repository history** — all decisions, deprecations, and milestones live here so other docs stay lean                      |
| [docs/plugins.md](docs/plugins.md)                       | **Plugin creation & guardrails** — scaffolding, 4-rung reuse ladder, and all 9 mandatory regression guardrails              |
| [docs/steam-architecture.md](docs/steam-architecture.md) | **Steam architecture directory** — cheat sheet of modules, stores, RPCs, and APIs for plugin developers                     |
| [docs/steam-debug.md](docs/steam-debug.md)               | **CEF DevTools guide** — how to inspect `http://localhost:8080`, target topology, Desktop vs Big Picture quirks             |
| [docs/knowledgebase.md](docs/knowledgebase.md)           | Millennium SDK, Steam's local data formats, provider sources, verified facts, and detailed failure traps                    |
| [docs/architecture.md](docs/architecture.md)             | Core/provider split, data flow, IPC, and provider contracts                                                                 |
| [docs/steam-components.md](docs/steam-components.md)     | **Deep reference** — section registry, stores, event shapes, achievements, notifications, recording RPCs, inspection method |
| [docs/steam-styles.md](docs/steam-styles.md)             | UI styling guidance — why hand-measuring pixels was superseded by component reuse and native block cloning                  |
| [docs/decisions.md](docs/decisions.md)                   | ADRs — _why_ things are the way they are                                                                                    |

Do not re-derive facts already recorded there. Do not contradict an ADR without
writing a new one that supersedes it. For all plugin development rules and guardrails,
refer to [docs/plugins.md](docs/plugins.md).

---

## Navigation Tips & Key Identifiers

### The two identifiers — do not confuse them

Steam uses **two different ids** for a non-Steam game:

| Id         | Width  | Where it appears                                                            |
| ---------- | ------ | --------------------------------------------------------------------------- |
| **appid**  | 32-bit | `shortcuts.vdf`, library URLs (`/library/app/<appid>`), `AppOverview.appid` |
| **gameid** | 64-bit | screenshot folders, `screenshots.vdf`, recordings                           |

They convert exactly (**✅ verified**, 9/9 folders on this machine):

```
gameid = (appid << 32) | 0x02000000
appid  = gameid >> 32
```

`0x02000000` is `33554432` — the constant low word marking a shortcut. The frontend
sees appids; the screenshot store is keyed by gameid. Always convert explicitly.

**Recordings do not follow the same rule.** `gamerecordings/` holds clips for native
Steam games too, and those are keyed by the **raw appid**:

```
clips/clip_18310622842007322624_…   non-Steam (composed gameid)
clips/clip_435150_…                 native Steam game (plain appid)
```

So pick the id form by app type, and anchor the match between underscores — a bare
substring search for `435150` also matches `4351501` and any gameid containing it.

### Hard-won environment facts

Non-default on this machine. Never hardcode standard paths — use
`millennium.steam_path()` and discover the rest.

| Thing             | Value here                                    | Default it is NOT               |
| ----------------- | --------------------------------------------- | ------------------------------- |
| Steam             | `C:\game\steam`                               | `C:\Program Files (x86)\Steam`  |
| Plugins           | `C:\game\steam\millennium\plugins`            | —                               |
| Millennium config | `C:\game\steam\millennium\config\config.json` | —                               |
| Steam user id     | `83513586`                                    | —                               |
| RetroArch         | `C:\emu\RetroArch` (portable)                 | `%APPDATA%\RetroArch`           |
| DevTools Port     | `127.0.0.1:8080` (IPv4)                       | `localhost:8080` (Node 24 IPv6) |

RetroArch is **portable**: `retroarch.cfg` uses `:\` to mean "the RetroArch install
dir", so `screenshot_directory = ":\screenshots"` → `C:\emu\RetroArch\screenshots`.
Expand it; never treat `:\` as literal.

The reference plugin's `dev.ps1` hardcodes the default Steam path. Our copy must take
it as a parameter.

### Conventions

- **Backend is LuaJIT**, not Python (`"backendType": "lua"`). The Python examples in
  the public docs are legacy.
- **Frontend is TypeScript + Steam's own React**, built with `millennium-ttc`.
- **Package manager is npm** (`npm run check`, `npm run build`). On Windows PowerShell, use `-ExecutionPolicy Bypass -File dev.ps1` for deploy scripts.
- Never commit secrets. `cheevos_token` / `cheevos_password` live in `retroarch.cfg` —
  read at runtime, never copy into the repo, logs, or docs.

---

## Agent Operating Routines

Follow these standardized routines during all development sessions:

### Routine 1: Multi-Tab Smoke Verification

Before declaring any UI or store modification complete, verify ALL four core views for a non-Steam shortcut:

1. **Post-Game Summary / Hero:** Top card renders screenshots, clips, and play evidence.
2. **Activity Feed:** Daily bucketed cards render with 16:9 thumbnails and `{Username} captured` headline.
3. **Your Stuff Tab:** Media section displays captures, duration badges, and item count (not the empty placeholder).
4. **Game Info Tab:** Capsule, description, developer/publisher credits, release date, and category badges render without the grey shortcut warning.

### Routine 2: Two-Way Navigation Lifecycle Smoke Test (Game A ➔ Game B ➔ Game A)

Never test only a single "clean restart ➔ open game" navigation path. Single-pass testing misses asynchronous unmount hooks, negative cache blacklisting, or route transition race conditions.

1. Open Non-Steam Shortcut A (verify all sections render).
2. Navigate to Native Game B (or Library Home).
3. Navigate back to Non-Steam Shortcut A (verify all sections, daily buckets, and cards remain 100% intact).

### Routine 3: Automated CDP Verification Suite

Run automated diagnostic scripts in `scratch/` against the running Steam client (`127.0.0.1:8080`):

```powershell
node scratch/test_nav_cycle.js   # Verifies two-way navigation lifecycle (hasEvent: true)
node scratch/check_all_tabs.js    # Verifies Post-Game Summary, Activity, Your Stuff, Game Info
```

### Routine 4: Build & Run

Run commands inside the respective plugin directory (`non-steam-games-activity` or `steamgriddb-artwork`):

```bash
npm install
npm run check        # tsc --noEmit
npm run build        # millennium-ttc --build prod
powershell -ExecutionPolicy Bypass -File dev.ps1 -NoRestart  # Deploy to live plugins dir without restarting
powershell -ExecutionPolicy Bypass -File dev.ps1             # Deploy + restart Steam
```

`dev.ps1` deploys a parallel `-dev` copy so the released plugin stays installed.
Backend changes need a Steam restart; frontend changes need only a reload (`Ctrl+R`
in the Steam devtools).

To start Steam with DevTools:

```powershell
.\start-steam-dev.ps1               # Start Steam with DevTools enabled on http://localhost:8080
.\start-steam-dev.ps1 -Restart      # Clean restart Steam into dev mode
.\start-steam-dev.ps1 -BigPicture   # Launch directly into Big Picture Mode with DevTools
.\start-steam-dev.ps1 -OpenBrowser  # Open http://localhost:8080/ in your browser
```

### Routine 5: End-of-Session Prune, Sync & Auto-Push

At the end of every session:

1. Update [CHANGELOG.md](CHANGELOG.md) with completed milestones, rationale, and findings.
2. Clear completed tasks from [TASK.md](TASK.md) so history lives in CHANGELOG and TASK stays lean.
3. Commit all changes:
    ```bash
    git add -A
    git commit -m "<concise descriptive message>"
    ```
4. Push to `origin/main` on GitHub:
    ```bash
    git push origin main
    ```
    Don't wait to be asked.
