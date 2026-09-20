# AGENTS.md

Guidance for AI agents working in this repository.

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

| Doc | What it holds |
| --- | --- |
| [TASK.md](TASK.md) | **Start here** — current status, what is next |
| [docs/knowledgebase.md](docs/knowledgebase.md) | Millennium SDK, Steam's local data formats, provider sources, verified facts |
| [docs/architecture.md](docs/architecture.md) | Core/provider split, the provider contract, data flow, RPC |
| [docs/steam-components.md](docs/steam-components.md) | How Steam itself builds the app detail page — the section registry, the stores behind Post-Game Summary and Activity, and the event shapes to feed them |
| [docs/steam-styles.md](docs/steam-styles.md) | Steam's measured styles — copy these, do not approximate |
| [docs/decisions.md](docs/decisions.md) | ADRs — *why* things are the way they are |

Do not re-derive facts already recorded there. Do not contradict an ADR without
writing a new one that supersedes it.

## The two identifiers — do not confuse them

This trips up everything. Steam uses **two different ids** for a non-Steam game:

| Id | Width | Where it appears |
| --- | --- | --- |
| **appid** | 32-bit | `shortcuts.vdf`, library URLs (`/library/app/<appid>`), `AppOverview.appid` |
| **gameid** | 64-bit | screenshot folders, `screenshots.vdf`, recordings |

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

## Hard-won environment facts

Non-default on this machine. Never hardcode standard paths — use
`millennium.steam_path()` and discover the rest.

| Thing | Value here | Default it is NOT |
| --- | --- | --- |
| Steam | `C:\game\steam` | `C:\Program Files (x86)\Steam` |
| Plugins | `C:\game\steam\millennium\plugins` | — |
| Millennium config | `C:\game\steam\millennium\config\config.json` | — |
| Steam user id | `83513586` | — |
| RetroArch | `C:\emu\RetroArch` (portable) | `%APPDATA%\RetroArch` |

RetroArch is **portable**: `retroarch.cfg` uses `:\` to mean "the RetroArch install
dir", so `screenshot_directory = ":\screenshots"` → `C:\emu\RetroArch\screenshots`.
Expand it; never treat `:\` as literal.

The reference plugin's `dev.ps1` hardcodes the default Steam path. Our copy must take
it as a parameter.

## Conventions

- **Backend is LuaJIT**, not Python (`"backendType": "lua"`). The Python examples in
  the public docs are legacy.
- **Frontend is TypeScript + Steam's own React**, built with `millennium-ttc`.
- Package manager is **pnpm**. Style: `oxfmt` (single quotes) + `oxlint`.
- Never commit secrets. `cheevos_token` / `cheevos_password` live in `retroarch.cfg` —
  read at runtime, never copy into the repo, logs, or docs.

## Working agreements

- **Verify against real local data before asserting.** These docs were built by reading
  this machine's actual `shortcuts.vdf`, `screenshots.vdf`, `retroarch.cfg` and
  screenshot folders. Keep that standard: check the file, don't guess the format.
  Probe scripts belong in the scratchpad, not the repo.
- **The core never reaches the network.** Network access is a provider concern.
  See [ADR-0012](docs/decisions.md#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins).
- **Steam's DOM is not a public API.** Class names are hashed and change between
  builds. Resolve via `findClassModule` at runtime; never hardcode a hashed class.
  See [ADR-0005](docs/decisions.md#adr-0005-render-into-steams-own-dom-via-resolved-class-modules).
- **Before building UI, check whether Steam already builds it.** This is the
  first question, not the last. Steam hides whole features from non-Steam games
  by **app type**, not by capability — its app-details section registry swaps
  the full list for `["nonsteam", "notes", "screenshots"]` when
  `BIsModOrShortcut()`. Every component and store behind that filter accepted a
  shortcut's appid the whole time. Restoring the section name and feeding
  Steam's own store produced the real Post-Game Summary and let us **delete
  ~1200 lines** of careful, tested, unnecessary reimplementation
  ([ADR-0022](docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).
  The inspection takes minutes and the method is written down:
  [docs/steam-components.md](docs/steam-components.md#reproducing-this-the-inspection-method).
  Work down this ladder and stop at the first rung that applies:
  1. **Restore what Steam already renders** — is it filtered out, not missing?
  2. **Feed Steam's own store** and let it render
     ([ADR-0009](docs/decisions.md#adr-0009-prefer-patching-steams-data-over-patching-its-dom)).
  3. **Render Steam's real component**, resolved from its module cache even
     when `@steambrew/client` does not export it.
  4. **Only then clone Steam's DOM** — last resort.

  A resolved Steam component cannot drift from native (spacing tweaks,
  animation changes, a future UI refresh); a hand-built copy can and will. The
  Post-Game Summary was cloned faithfully, passed testing, and was still
  discarded: it needed five CSS modules resolved by probe key — one of them
  **ambiguous across two different modules**, which silently reintroduced an
  already-fixed bug with no code change — and Steam's own spacing misbehaved
  against content it was never measured for. **If you are measuring pixels to
  match Steam, you are probably on the wrong rung.**

  Resolve by a stable, minification-proof signature (real `prototype` method
  names — these are not mangled, only variable/module bindings are — or a
  class-map probe key), **never by a raw numeric module id**, which reshuffles
  between Steam builds. Always keep a graceful fallback, so a Steam update
  degrades the page instead of crashing it.
- **If you do end up drawing something, match Steam by measuring, not by eye.**
  This applies only on the last rung above — reaching for it early is the
  mistake ADR-0022 corrected. Read `getComputedStyle` off a native element and
  copy the value into [docs/steam-styles.md](docs/steam-styles.md). Check
  `backgroundImage` too — Steam uses gradients where a flat colour would be
  expected ([ADR-0021](docs/decisions.md#adr-0021-measure-steams-styles-from-the-live-client-and-keep-a-style-bible)).
- **Prefer patching Steam's data over its DOM** ([ADR-0009](docs/decisions.md#adr-0009-prefer-patching-steams-data-over-patching-its-dom)).
- **Respect third-party APIs.** RetroAchievements is donation-funded: cache hard,
  never poll, send a descriptive `User-Agent` ([ADR-0007](docs/decisions.md#adr-0007-cache-retroachievements-responses-on-disk)).
- **Push to GitHub when a session's work is done.** Once a batch of work is
  complete (docs updated, changes verified, TASK.md reflects the true state),
  commit and push to `origin/main` rather than leaving it sitting in the
  working tree. Don't wait to be asked. Still confirm before pushing if
  something in the diff looks destructive or unverified.

## Build & run

```bash
pnpm install
pnpm check        # tsc --noEmit
pnpm build        # millennium-ttc --build prod
pnpm dev          # build + deploy to the live plugins dir + restart Steam
```

`pnpm dev` deploys a parallel `-dev` copy so the released plugin stays installed.
Backend changes need a Steam restart; frontend changes need only a reload (`Ctrl+R`
in the Steam devtools). Steam must run with `-dev` to expose CEF devtools on
`http://localhost:8080`.
