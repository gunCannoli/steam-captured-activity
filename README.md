# millennium-plugins

A private workspace for building [Millennium](https://steambrew.app/) plugins —
mods for the desktop Steam Client.

Plugins are developed here as subfolders and published individually as public
repositories once they are ready for release. See [docs/plugin.md](docs/plugin.md).

## The idea

Steam's app detail page is rich for owned games: a post-game summary, an activity
feed by date, achievements, screenshots, playtime. For a **non-Steam game** it
shows a single grey box:

> Some detailed information on … is unavailable because it is a non-Steam game or
> mod.

That is misleading twice over. Steam *has* captured screenshots and recordings
for those games, filed under a per-game id. And Steam already has the UI to show
them — it hides those sections from non-Steam games with a **one-line app-type
filter** in its section registry, then renders the grey box instead.

So this workspace does not rebuild that page. It restores the sections Steam
already draws, feeds Steam's own stores, and lets Steam render
([ADR-0022](docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).
Then it makes that extensible.

**One core plugin, plus optional providers:**

```
non-steam-games-activity  (core)      Steam's own screenshots + recordings
   ├── retroarch          (provider)  playtime, emulator screenshots
   ├── retroachievements  (provider)  achievements, badges, unlock dates
   ├── guides-artwork     (provider)  manuals, box art (ScreenScraper / Archive.org)
   └── game-metadata      (provider)  publisher, developer, release date (IGDB / TheGamesDB)
```

The core works with **zero providers** — no emulator, no API key, no network.
Providers enrich games they recognise and fail silently for the rest. See
[docs/architecture.md § Providers planned](docs/architecture.md#providers-planned)
for what each one needs and where its data comes from.

## Plugins

| Plugin | Status | Public repo |
| --- | --- | --- |
| [non-steam-games-activity](non-steam-games-activity/) | 🚧 Post-Game Summary shipped; Activity feed + Big Picture ahead | not yet published |
| `retroarch` | 📋 planned | — |
| `retroachievements` | 📋 planned | — |
| `guides-artwork` | 📋 planned | — |
| `game-metadata` | 📋 planned | — |

## Documentation

| Doc | What it holds |
| --- | --- |
| [TASK.md](TASK.md) | Current status, what is next |
| [docs/plugin.md](docs/plugin.md) | How to create a plugin, and how to publish one |
| [AGENTS.md](AGENTS.md) | Conventions and environment facts for contributors and AI agents |
| [docs/knowledgebase.md](docs/knowledgebase.md) | Millennium SDK, Steam's local data formats, verified facts |
| [docs/architecture.md](docs/architecture.md) | Core/provider split, data flow, the provider contract |
| [docs/decisions.md](docs/decisions.md) | ADRs — why things are the way they are |
| [CHANGELOG.md](CHANGELOG.md) | Workspace-level history |

## Why this repo is private

It documents a specific machine's Steam and RetroArch layout, including a Steam
user id and library contents. Individual plugins are published as public repos
without that context. Never commit `retroarch.cfg` (it holds RetroAchievements
credentials), `.vdf` files, or anything from Steam's `userdata/`.

## Requirements

- [Millennium](https://steambrew.app/) installed into the Steam client
- Node 20+ and [pnpm](https://pnpm.io/)
- A standalone [Lua](https://luabinaries.sourceforge.net/) interpreter to run the
  backend tests (Millennium ships only its embedded VM)
