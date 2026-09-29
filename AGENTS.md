# AGENTS.md

Guidance and standard operating procedures for AI agents working in this repository.

## What this repo is

A workspace for building **Millennium** plugins (Steam Client homebrew mods).

The product is a **core plugin plus optional provider plugins**:

- **`steam-cartridges`** (the backbone; ex `non-steam-games-activity` + `steamgriddb-artwork`, ADR-0032) — gives **any** non-Steam game
  Steam's own rich app detail page, using only data Steam already has: the
  screenshots and recordings Steam itself captured. It does not rebuild that
  page — Steam hides it from shortcuts by app type, so the plugin restores the
  section and feeds Steam's own store. No emulator, no network, no API key.
- **Providers** — optional plugins that enrich the timeline for games they recognise:
  `retroachievements`, `retroarch`, guides, artwork, and so on.

The core must be useful alone and must never depend on a provider. See
[docs/millennium-architecture.md](docs/millennium-architecture.md).

## Read this before writing code

| Doc | Its one job |
| --- | --- |
| [docs/steam-architecture.md](docs/steam-architecture.md) | **Docs index — start here.** Which doc to read for your situation, every doc's one job, the `steam-cartridges` layer docs |
| [TASK.md](TASK.md) | Current status and what is next |
| [CHANGELOG.md](CHANGELOG.md) | **Repository history** — all decisions, deprecations, and milestones live here so other docs stay lean |
| [docs/plans/steam-cartridges-architecture-migration-plan.md](docs/plans/steam-cartridges-architecture-migration-plan.md) | The `steam-cartridges` migration (ADR-0039). M3 is done (2026-09-28); the feature freeze on `steam-cartridges` has ended |
| [docs/plugins.md](docs/plugins.md) | **How to build a plugin & every regression guardrail** — scaffold, reuse ladder, guardrails, develop/deploy, test, publish |
| [docs/steam-components.md](docs/steam-components.md) | **Steam's internals** — opens with the map (topology, stores, stable resolution signatures), then verified deep traces |
| [docs/steam-debug.md](docs/steam-debug.md) | **Inspecting the live client** — CDP targets, the inspection method, Big Picture traps, hung-UI diagnosis, cost-efficient debugging |
| [docs/knowledgebase.md](docs/knowledgebase.md) | Facts outside Steam's UI code — Millennium SDK & config API, CEF quirks, Steam's file formats, provider sources, prior art |
| [docs/millennium-architecture.md](docs/millennium-architecture.md) | Our suite: core/provider split, data flow, RPC, provider contract |
| [docs/decisions.md](docs/decisions.md) | ADRs — _why_ things are the way they are |
| [docs/plans/](docs/plans/) | Per-feature and per-bugfix plans; every plan follows [the plan writing standard](docs/plans/README.md) |

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

Run the live diagnostic scripts in `steam-cartridges/tests/live/` (or `npm run test:live` inside `steam-cartridges/`) against the running Steam client (`127.0.0.1:8080`):

```powershell
node steam-cartridges/tests/live/test_nav_cycle.js   # Verifies two-way navigation lifecycle (hasEvent: true)
node steam-cartridges/tests/live/check_all_tabs.js    # Verifies Post-Game Summary, Activity, Your Stuff, Game Info
```

For cheap ways to answer a debugging question (cheapest method first, screenshots
last), see [steam-debug.md § Cost-Efficient Debugging](docs/steam-debug.md#7-cost-efficient-debugging).

### Routine 4: Build & Run

Backend tests: `NSGA_STEAM_ROOT=C:/game/steam lua tests/test_backend.lua` inside `steam-cartridges/` (LuaJIT 2.1 at `C:\dev\tools\lua`, on the user `PATH`; fixture counts track the live library).

Run commands inside the respective plugin directory (`steam-cartridges`):

```bash
npm install
npm run check        # tsc --noEmit
npm run build        # millennium-ttc --build prod
powershell -ExecutionPolicy Bypass -File dev.ps1 -NoRestart  # Deploy to live plugins dir without restarting
powershell -ExecutionPolicy Bypass -File dev.ps1             # Deploy + restart Steam
```

`dev.ps1` deploys a parallel `-dev` copy so the released plugin stays installed.
Backend and frontend changes both need a graceful Steam restart (`dev.ps1` without
`-NoRestart`). **Do not reload SharedJSContext** (`Ctrl+R` / `location.reload()`): it
can open a blocking "Save as" dialog for `/routes/library/home` (see
[plugins.md § 4 Develop](docs/plugins.md#4-develop)).

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

### Routine 6: No AI Attribution on Anything That Reaches `SteamClientHomebrew/Millennium`

`SteamClientHomebrew/Millennium` (the upstream project — issues, PRs, the
`gunCannoli/Millennium` fork used to open them) does not want Anthropic/Claude on
its contributor list. **Any commit, PR branch, or PR/issue body destined for that
repo must not contain:**

- `Co-Authored-By: Claude ...` / `Co-Authored-By: ... @anthropic...` trailers
- "🤖 Generated with [Claude Code]" or similar footers in PR/issue descriptions

This repo (`millennium-plugins`, private) is exempt by default — its own history
still carries `Co-Authored-By: Claude ...` trailers, which is fine here. Strip
attribution only for content that leaves this repo: a PR opened against
`SteamClientHomebrew/Millennium`, or a fork branch pushed for that purpose. Check
before opening the PR, not after — a force-push to rewrite history once a commit
is already linked from an issue/PR timeline is a partial fix at best. GitHub
retains dangling commit objects by SHA (direct URL still resolves, and any
existing issue "added a commit that references this issue" timeline entry keeps
pointing at the old SHA) even after a force-push removes the commit from the
branch; only a GitHub support ticket can purge it, and even that is not
guaranteed quickly. So: get the message right before the first push, not after.

If a cleanup is still needed:

1. Identify every affected commit (`gh pr view <url> --json commits`, or `git log
   --format='%H%n%B---END---' | grep -B5 -i 'co-authored-by.*claude\|generated with'`
   for a broader sweep).
2. Single commit on a PR branch: `git commit --amend` (keep the rest of the
   message; drop only the attribution line/trailer), then
   `git push --force-with-lease`.
3. Multiple commits / full branch history: `git filter-branch -f --msg-filter
   '<strip-script>' -- <branch>` (no file-content changes — message-only filter
   keeps trees identical), verify with `git diff <old-ref> <branch> --stat` (must
   be empty) and a grep for remaining mentions, then
   `git push --force-with-lease` (or plain `--force` if lease rejects a stale
   remote-tracking ref you've already confirmed is safe to overwrite).
4. Always make a local backup ref/branch before rewriting (`git branch
   backup-<name> HEAD`) and confirm the rewrite before force-pushing — this
   changes every downstream SHA and is disruptive for any other clone.
5. Update the PR/issue body itself separately (`gh pr edit <url> --body-file
   ...`) — rewriting the commit does not touch the description text.
