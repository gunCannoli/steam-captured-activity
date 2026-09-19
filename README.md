# millennium-plugins

A private workspace for building [Millennium](https://steambrew.app/) plugins —
mods for the desktop Steam Client.

Plugins are developed here as subfolders and published individually as public
repositories once they are ready for release. See [plugin.md](plugin.md).

## The idea

Steam's app detail page is rich for owned games: a post-game summary, an activity
feed by date, achievements, screenshots, playtime. For a **non-Steam game** it
shows a single grey box:

> Some detailed information on … is unavailable because it is a non-Steam game or
> mod.

That is misleading. Steam *has* captured screenshots and recordings for those
games — it files them under a per-game id and then declines to build a page
around them. This workspace builds that page, and makes it extensible.

**One core plugin, plus optional providers:**

```
non-steam-games-activity  (core)   Steam's own screenshots + recordings
   ├── retroachievements  (provider)  achievements, badges, unlock dates
   ├── retroarch          (provider)  playtime, emulator screenshots
   ├── artwork            (provider)  box art, logos
   └── guides             (provider)  links, manuals
```

The core works with **zero providers** — no emulator, no API key, no network.
Providers enrich games they recognise and fail silently for the rest.

## Plugins

| Plugin | Status | Public repo |
| --- | --- | --- |
| [non-steam-games-activity](non-steam-games-activity/) | 🚧 Phase 1 of 9 — backend done, UI not started | not yet published |
| `retroachievements` | 📋 planned | — |
| `retroarch` | 📋 planned | — |

## Documentation

| Doc | What it holds |
| --- | --- |
| [TASK.md](TASK.md) | Current phase, what is next, the smoke test |
| [plugin.md](plugin.md) | How to create a plugin, and how to publish one |
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
