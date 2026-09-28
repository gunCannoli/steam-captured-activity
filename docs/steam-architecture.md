# Docs index — start here

**This doc's job:** the table of contents. Every doc in this repo has one job
and a row below. Read this page first, pick the doc for your situation, and read
only that. If a fact has no home in the table, it goes into the doc whose job
covers it, not into a new doc.

**The product:** Millennium plugins that give a non-Steam game Steam's own app
detail page (desktop and Big Picture) by restoring the sections Steam hides from
shortcuts and feeding Steam's own stores. The core plugin is `steam-cartridges`.
It is being migrated to a ports-and-adapters architecture
([ADR-0039](decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam)),
and **new features are frozen** until migration step M3 is done.

---

## 1. Start here, by situation

| You are… | Read, in this order |
| --- | --- |
| New to the repo, any role | [AGENTS.md](../AGENTS.md) → [TASK.md](../TASK.md) → this page |
| Executing a plan (implementer) | The plan in [plans/](plans/) → [plugins.md § Guardrails](plugins.md#guardrails--regression-prevention-must-read-before-writing-code) → the layer doc of the module you touch (§ 3) |
| Working on the `steam-cartridges` migration | [Migration plan](plans/steam-cartridges-architecture-migration-plan.md) (its § 0 is the execution manual) → [ADR-0039](decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam) |
| Investigating a Steam feature or internals | [steam-components.md § Map](steam-components.md#map-runtime-topology) → the deep trace in the same doc |
| Debugging the live client (CDP, a hang, a crash) | [steam-debug.md](steam-debug.md) (§ 7 cheap probes first; Trap 10 for a hung UI) |
| Writing or fixing plugin code | [plugins.md](plugins.md): reuse ladder, all guardrails, develop/deploy/test |
| Needing a fact outside Steam's UI code (SDK, config API, file formats, RetroAchievements, RetroArch) | [knowledgebase.md](knowledgebase.md) |
| Asking "why is it like this?" | [decisions.md](decisions.md) (ADRs, newest at the bottom) |
| Verifying a change (verifier) | [AGENTS.md Routines 1–3](../AGENTS.md#agent-operating-routines) → [steam-debug.md § 7](steam-debug.md#7-cost-efficient-debugging) |
| Writing a plan (architect) | [plans/README.md](plans/README.md) (the standard) → [steam-debug.md](steam-debug.md) for evidence |

---

## 2. Every doc

### Workspace

| Doc | Its one job |
| --- | --- |
| [AGENTS.md](../AGENTS.md) | Operating routines for agents, identifiers, environment facts |
| [TASK.md](../TASK.md) | What is being done now and next. Nothing else |
| [CHANGELOG.md](../CHANGELOG.md) | All history: decisions, findings, verification records |
| [plans/README.md](plans/README.md) | The plan writing standard |
| [plans/](plans/) | One plan per feature or fix. Executed plans are deleted (history stays in CHANGELOG) |

### Steam and Millennium reference (true regardless of our code)

| Doc | Its one job |
| --- | --- |
| [steam-components.md](steam-components.md) | Steam's client internals. Opens with **the map** (runtime topology, which store owns what, every stable resolution signature), then the verified deep traces |
| [steam-debug.md](steam-debug.md) | How to inspect the live client over CDP: targets, inspection method, Big Picture traps, hung-UI diagnosis, cheap probes |
| [knowledgebase.md](knowledgebase.md) | Verified facts outside Steam's UI code: Millennium SDK and config API, CEF quirks, Steam file formats, RetroAchievements, RetroArch, prior art |

### Rules and reasons

| Doc | Its one job |
| --- | --- |
| [plugins.md](plugins.md) | How to build, change, deploy and test a plugin, and **every regression guardrail** (numbered, cited by code) |
| [decisions.md](decisions.md) | ADRs: why things are the way they are. Reverse one only with a new ADR |

### Our plugins

| Doc | Its one job |
| --- | --- |
| [millennium-architecture.md](millennium-architecture.md) | The suite: core/provider split, data flow, RPC, provider contract. Its module layout is out of date until M9 |
| [plans/steam-cartridges-architecture-migration-plan.md](plans/steam-cartridges-architecture-migration-plan.md) | The `steam-cartridges` migration: target architecture, execution manual, child steps M0a–M9 |
| [steam-cartridges-achievements.md](steam-cartridges-achievements.md) | Current reference for `steam-cartridges` achievements (channels, stores, toasts). Becomes the achievements layer doc in M6 |
| `docs/steam-cartridges/` (§ 3) | One doc per architecture layer, created by the migration step that builds the layer |
| [plans/phase7-and-alpha-plan.md](plans/phase7-and-alpha-plan.md) | `enhanced-achievements` / `enhanced-notifications` phase 7 and the user's alpha test checklist (cited by their code) |

---

## 3. steam-cartridges architecture layers

Data flows one way: **sensors** see what the user does in Steam → **services**
(backend) resolve and fetch → one **`GameRecord`** per shortcut → **surfaces**
write it into Steam. Only surfaces ever write to Steam.

```
Steam UI ─► sensors ─► app (thin) ─► ports/backend ─RPC─► services ─► sources (IGDB, RA, Steam store…)
                          │                                   └─► storage (JSON files)
                          ▼
                     kernel/record (GameRecord) ─► surfaces ─► Steam UI
```

Each layer gets **one doc**, written by the step that creates the layer and
updated by every later step that changes it (template in the
[migration plan § 0.6](plans/steam-cartridges-architecture-migration-plan.md#06-the-layer-doc-template)).

| Layer | Doc (created by) | Status |
| --- | --- | --- |
| Overview: layers, import rule, how to add a feature | `docs/steam-cartridges/README.md` (M1) | planned |
| Safety: kill switches, safe mode, error budget, fail-open hooks | `docs/steam-cartridges/safety.md` (M0b) | planned |
| Kernel: `ShortcutId`, events, `GameRecord`, `Surface` contract | `docs/steam-cartridges/kernel.md` (M1) | planned |
| Sensors: view, lifecycle, collections, owned apps | `docs/steam-cartridges/sensors.md` (M2) | planned |
| Surfaces: the only code that writes to Steam, one section each | `docs/steam-cartridges/surfaces.md` (M3.1, a section added by each M3.x) | planned |
| Backend port and RPC facade | `docs/steam-cartridges/rpc.md` (M4) | planned |
| Resolver service (Steam native match, web identity, routing policy) | `docs/steam-cartridges/service-resolver.md` (M4) | planned |
| Metadata service and its sources | `docs/steam-cartridges/service-metadata.md` (M5) | planned |
| Achievements service, sources, observer | `docs/steam-cartridges/service-achievements.md` (M6, replaces [steam-cartridges-achievements.md](steam-cartridges-achievements.md)) | planned |
| Freshness and ingestion | `docs/steam-cartridges/service-freshness.md` (M7) | planned |
| Settings panels | `docs/steam-cartridges/settings.md` (M8) | planned |

When a layer doc is created, its row flips to `current` and gets a link, in the
same commit.

---

## 4. Roles

- **Architect** (diagnosis, planning): [steam-debug.md](steam-debug.md) and
  [steam-components.md](steam-components.md) for evidence, then a plan in
  [plans/](plans/) to [the standard](plans/README.md).
- **Implementer**: executes one plan exactly. The [plugins.md](plugins.md)
  guardrails and the plan's banned actions are non-negotiable.
- **Verifier**: [AGENTS.md](../AGENTS.md) Routines 1–3 plus the plugin's
  `tests/`, using [steam-debug.md § 7](steam-debug.md#7-cost-efficient-debugging).

---

## 5. Removed docs (2026-09-28)

These were deleted because they were executed, superseded or historical, and
kept confusing agents. Read any of them with `git show 0d599cf:<path>`.

| Path | Why removed | Where its content went |
| --- | --- | --- |
| `docs/steam-architecture.md` (old content) | Replaced by this index | The Steam map → [steam-components.md § Map](steam-components.md#map-runtime-topology) |
| `docs/steam-styles.md` | Superseded "style bible" | [plugins.md § Rules that apply on every rung](plugins.md#rules-that-apply-on-every-rung) |
| `docs/steam-cartridges.md` | Original research and phase plan; phases done | ADR-0032–0038; open SGDB item → [TASK.md](../TASK.md) Later |
| `docs/steam-cartridges-retrogames-achievements.md` | Spec + plan, superseded by the migration | Open goals → migration plan M6 inputs |
| `docs/plans/steam-cartridges-dataflow-audit-plan.md` | Executed | [CHANGELOG.md](../CHANGELOG.md) 2026-09-28 |
| `docs/plans/steam-cartridges-community-plan.md` | Executed | [CHANGELOG.md](../CHANGELOG.md) 2026-09-27 |
| `docs/plans/steam-cartridges-settings-redesign-plan.md` | Executed | `steam-cartridges/CHANGELOG.md`; future work → M8 |
| `docs/plans/steam-cartridges-achievements-plan.md` | Pending; absorbed | Migration plan M6 inputs |
| `docs/plans/steam-cartridges-native-achievements-mirror-plan.md` | Not started; absorbed | Migration plan M6 inputs |
| `docs/plans/steam-cartridges-retrogames-achievements-plan.md` | Pending; absorbed | Migration plan M6 inputs |
