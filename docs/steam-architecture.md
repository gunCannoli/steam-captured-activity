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

| You are…                                                                                             | Read, in this order                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New to the repo, any role                                                                            | [AGENTS.md](../AGENTS.md) → [TASK.md](../TASK.md) → this page                                                                                                                                                                        |
| Executing a plan (implementer)                                                                       | The plan in [plans/](plans/) → [plugins.md § Guardrails](plugins.md#guardrails--regression-prevention-must-read-before-writing-code) → the layer doc of the module you touch (§ 3)                                                   |
| Working on the `steam-cartridges` migration                                                          | [Migration plan](plans/steam-cartridges-architecture-migration-plan.md) (its § 0 is the execution manual) → [ADR-0039](decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam) |
| Investigating a Steam feature or internals                                                           | [steam-components.md § Map](steam-components.md#map-runtime-topology) → the deep trace in the same doc                                                                                                                               |
| Debugging the live client (CDP, a hang, a crash)                                                     | [steam-debug.md](steam-debug.md) (§ 7 cheap probes first; Trap 10 for a hung UI)                                                                                                                                                     |
| Writing or fixing plugin code                                                                        | [plugins.md](plugins.md): reuse ladder, all guardrails, develop/deploy/test                                                                                                                                                          |
| Needing a fact outside Steam's UI code (SDK, config API, file formats, RetroAchievements, RetroArch) | [knowledgebase.md](knowledgebase.md)                                                                                                                                                                                                 |
| Asking "why is it like this?"                                                                        | [decisions.md](decisions.md) (ADRs, newest at the bottom)                                                                                                                                                                            |
| Verifying a change (verifier)                                                                        | [AGENTS.md Routines 1–3](../AGENTS.md#agent-operating-routines) → [steam-debug.md § 7](steam-debug.md#7-cost-efficient-debugging)                                                                                                    |
| Writing a plan (architect)                                                                           | [plans/README.md](plans/README.md) (the standard) → [steam-debug.md](steam-debug.md) for evidence                                                                                                                                    |

---

## 2. Every doc

### Workspace

| Doc                                | Its one job                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| [AGENTS.md](../AGENTS.md)          | Operating routines for agents, identifiers, environment facts                        |
| [TASK.md](../TASK.md)              | What is being done now and next. Nothing else                                        |
| [CHANGELOG.md](../CHANGELOG.md)    | All history: decisions, findings, verification records                               |
| [plans/README.md](plans/README.md) | The plan writing standard                                                            |
| [plans/](plans/)                   | One plan per feature or fix. Executed plans are deleted (history stays in CHANGELOG) |

### Steam and Millennium reference (true regardless of our code)

| Doc                                        | Its one job                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [steam-components.md](steam-components.md) | Steam's client internals. Opens with **the map** (runtime topology, which store owns what, every stable resolution signature), then the verified deep traces |
| [steam-debug.md](steam-debug.md)           | How to inspect the live client over CDP: targets, inspection method, Big Picture traps, hung-UI diagnosis, cheap probes                                      |
| [knowledgebase.md](knowledgebase.md)       | Verified facts outside Steam's UI code: Millennium SDK and config API, CEF quirks, Steam file formats, RetroAchievements, RetroArch, prior art               |

### Rules and reasons

| Doc                          | Its one job                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [plugins.md](plugins.md)     | How to build, change, deploy and test a plugin, and **every regression guardrail** (numbered, cited by code) |
| [decisions.md](decisions.md) | ADRs: why things are the way they are. Reverse one only with a new ADR                                       |

### Our plugins

| Doc                                                                                                            | Its one job                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [millennium-architecture.md](millennium-architecture.md)                                                       | The suite: core/provider split, data flow, RPC, provider contract. Its module layout is out of date until M9                                                                    |
| [plans/steam-cartridges-architecture-migration-plan.md](plans/steam-cartridges-architecture-migration-plan.md) | The `steam-cartridges` migration: target architecture, execution manual, child steps M0a–M9                                                                                     |
| [steam-cartridges/service-achievements.md](steam-cartridges/service-achievements.md)                           | The achievements layer doc (source order, `supports` rules, `CheckUnlocks`) plus the earlier reference for channels, stores and toasts (was `steam-cartridges-achievements.md`) |
| `docs/steam-cartridges/` (§ 3)                                                                                 | One doc per architecture layer, created by the migration step that builds the layer                                                                                             |
| [plans/phase7-and-alpha-plan.md](plans/phase7-and-alpha-plan.md)                                               | `enhanced-achievements` / `enhanced-notifications` phase 7 and the user's alpha test checklist (cited by their code)                                                            |

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

| Layer                                                               | Doc (created by)                                                                                                       | Status  |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------- |
| Overview: layers, import rule, how to add a feature                 | [README.md](steam-cartridges/README.md) (M0c)                                                                          | current |
| Safety: kill switches, safe mode, error budget, fail-open hooks     | [safety.md](steam-cartridges/safety.md) (M0b)                                                                          | current |
| Kernel: `ShortcutId`, events, `GameRecord`, `Surface` contract      | [kernel.md](steam-cartridges/kernel.md) (M1)                                                                           | current |
| Sensors: view, lifecycle, collections (owned apps: M4)              | [sensors.md](steam-cartridges/sensors.md) (M2)                                                                         | current |
| Surfaces: the only code that writes to Steam, one section each      | [surfaces.md](steam-cartridges/surfaces.md) (M3.1, a section added by each M3.x)                                       | current |
| Backend port and RPC facade                                         | [rpc.md](steam-cartridges/rpc.md) (M4.0: inventory; M4b/M5a: facade)                                                   | current |
| Resolver service (Steam native match, web identity, routing policy) | [service-resolver.md](steam-cartridges/service-resolver.md) (M4b)                                                      | current |
| Metadata service and its sources                                    | [service-metadata.md](steam-cartridges/service-metadata.md) (M5a)                                                      | current |
| Artwork service and its sources                                     | [service-artwork.md](steam-cartridges/service-artwork.md) (M5c)                                                        | current |
| Achievements service, sources, observer                             | [service-achievements.md](steam-cartridges/service-achievements.md) (M6a; replaced `steam-cartridges-achievements.md`) | current |
| Freshness and ingestion                                             | [service-freshness.md](steam-cartridges/service-freshness.md) (M7a)                                                    | current |
| Next features (Game Data editor, Media)                             | [steam-cartridges-features-plan.md](plans/steam-cartridges-features-plan.md)                                           | plan    |
| Settings panels and the Troubleshooting panel                       | [settings.md](steam-cartridges/settings.md) (M8)                                                                       | current |

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
