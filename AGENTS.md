# AGENTS.md

Guidance for AI agents working in this repository.

## What this repo is

A workspace for building **Millennium** plugins (Steam Client homebrew mods).

The product is a **core plugin plus optional provider plugins**:

- **`non-steam-games-activity`** (the backbone) — rebuilds Steam's rich app detail
  page for **any** non-Steam game, using only data Steam already has: the screenshots
  and recordings Steam itself captured. No emulator, no network, no API key.
- **Providers** — optional plugins that enrich the timeline for games they recognise:
  `retroachievements`, `retroarch`, guides, artwork, and so on.

The core must be useful alone and must never depend on a provider. See
[docs/architecture.md](docs/architecture.md).

## Read this before writing code

| Doc | What it holds |
| --- | --- |
| [TASK.md](TASK.md) | **Start here** — current phase, what is next, the smoke test |
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
- **Match Steam by measuring, not by eye.** Read `getComputedStyle` off a native
  element and copy the value into [docs/steam-styles.md](docs/steam-styles.md).
  Check `backgroundImage` too — Steam uses gradients where a flat colour would
  be expected ([ADR-0021](docs/decisions.md#adr-0021-measure-steams-styles-from-the-live-client-and-keep-a-style-bible)).
- **Steam's DOM is not a public API.** Class names are hashed and change between
  builds. Resolve via `findClassModule` at runtime; never hardcode a hashed class.
  See [ADR-0005](docs/decisions.md#adr-0005-render-into-steams-own-dom-via-resolved-class-modules).
- **Reuse Steam's real components over recreating them.** This plugin's job is to
  make non-Steam games look like they have a native page, not to run a parallel
  UI that merely resembles one. When a real Steam component for the behaviour
  you need is reachable — including one not exported by `@steambrew/client`, via
  `findModuleExport`/`findModule` from Steam's own module cache — render that
  component directly rather than reimplementing its markup or behaviour by hand,
  even if a hand-built version already exists and passes testing. A resolved
  Steam component cannot drift from native (spacing tweaks, animation changes, a
  future UI refresh); a hand-built copy can and will. Resolve by a stable,
  minification-proof signature (real `prototype` method names — these are not
  mangled, only variable/module bindings are — or a class-map probe key), never
  by a raw numeric module id, which reshuffles between Steam builds. Always keep
  a graceful fallback for when resolution fails, so a Steam update degrades the
  page instead of crashing it. See the Post-Game Summary's carousel
  (`non-steam-games-activity/frontend/components/carousel.tsx`) for a worked
  example, including one it replaced: a from-scratch reimplementation of Steam's
  scrolling carousel that worked, but was still discarded in favour of rendering
  the real `Pageable`/`Carousel` components once they were confirmed reachable.
  [docs/steam-components.md](docs/steam-components.md) maps the whole app detail
  page this way: Steam hides Post-Game Summary and Activity from non-Steam games
  with a one-line app-type filter in its section registry, not because the data
  is missing — both stores accept a shortcut's appid and render natively once
  fed. Prefer feeding those stores over rebuilding their output.
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
