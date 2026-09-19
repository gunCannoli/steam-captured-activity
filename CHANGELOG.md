# Changelog

Workspace-level history: documentation, conventions, and decisions that span
plugins. Each plugin keeps its own changelog for anything user-facing —
see [non-steam-games-activity/CHANGELOG.md](non-steam-games-activity/CHANGELOG.md).

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This repo is private and unversioned; entries are grouped by date.

## [Unreleased]

### Added

- **Workspace scaffolding** — `README.md`, `CHANGELOG.md`, `plugin.md`,
  `.gitignore`, and per-plugin changelogs. Repo initialised and pushed to
  GitHub as private.
- **`plugin.md`** — how to create a plugin in this workspace and publish it as a
  standalone public repo via `git subtree`. The split was dry-run verified: it
  produces the plugin files at the repo root with no workspace docs and no
  machine-specific data.
- **`.gitattributes`** — LF in the repo for sources, CRLF for `.ps1`.
- **`AGENTS.md`** — conventions, environment facts, and the two-identifier rule
  that everything else depends on.
- **`TASK.md`** — 9 phases through to a shipped first plugin, with a 15-row smoke
  test and a definition of done.
- **`docs/knowledgebase.md`** — Millennium SDK mechanics, Steam's local data
  formats (`shortcuts.vdf`, `screenshots.vdf`, `gamerecordings/`), and
  RetroAchievements / RetroArch as provider sources. Facts marked ✅ were read
  off a real install, not inferred from documentation.
- **`docs/architecture.md`** — the core/provider split, data flow, module layout
  and the provider contract.
- **`docs/decisions.md`** — 17 ADRs.

### Changed

- **Restructured from a single retro-games plugin into a core plus providers**
  (ADR-0012). The original design made RetroArch and RetroAchievements
  structural, which excluded most of the library — including AM2R, the game that
  motivated the project. Probing Steam's own capture store showed the core could
  stand on exact arithmetic instead of fuzzy ROM matching, so providers became
  optional enrichment.

### Notes

Key findings recorded during this period, all verified against a real install:

- Steam stores non-Steam captures under a 64-bit `gameid`, derived from the
  32-bit `appid` by `(appid << 32) | 0x02000000`. Verified on 9/9 folders.
- **Recordings break that rule**: native Steam games key on the raw appid
  (`clip_435150_…`) while non-Steam games use the composed gameid.
- Recordings are MPEG-DASH (`session.mpd` + `.m4s` chunks), not mp4, but ship
  with a ready-made `thumbnail.jpg`.
- Big Picture is a separate popup window (`SP BPM_`), not a separate sandbox, so
  it needs a second renderer but no backend changes (ADR-0016).
- `steamloopback.host` is jailed to `<Steam>/steamui/` and cannot serve files
  from `userdata/`, so capture images cross the RPC boundary as base64 data URIs
  (ADR-0017 supersedes ADR-0015).
