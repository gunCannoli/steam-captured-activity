# Docs index — start here

**This doc's job:** the table of contents. Every doc in this repo has one job and a
row below. Read this page first, pick the doc for your situation, and read only that.
If a fact has no home in the table, it goes into the doc whose job covers it, not
into a new doc.

**The product:** Millennium plugins that give a non-Steam game Steam's own app
detail page (desktop and Big Picture). The core plugin is `steam-cartridges`, a
ports-and-adapters modular monolith
([ADR-0039](decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam)).

**Two architecture docs, two subjects:**
[steam-architecture.md](steam-architecture.md) is Steam itself;
[steam-cartridges.md](steam-cartridges.md) is our plugin.

---

## 1. Start here, by situation

| You are… | Read, in this order |
| --- | --- |
| New to the repo, any role | [AGENTS.md](../AGENTS.md) → [TASK.md](../TASK.md) → this page |
| Executing a plan (implementer) | The plan in [plans/](plans/) → [plugins.md § Guardrails](plugins.md#guardrails--regression-prevention-must-read-before-writing-code) → the layer doc of the module you touch ([steam-cartridges.md § 3](steam-cartridges.md#3-layer-docs)) |
| Adding a feature to `steam-cartridges` | [steam-cartridges.md § 4](steam-cartridges.md#4-adding-a-feature) → the layer docs it names |
| Understanding how Steam is built | [steam-architecture.md](steam-architecture.md) → [steam-components.md § Map](steam-components.md#map-runtime-topology) |
| Investigating a Steam feature or internals | [steam-components.md](steam-components.md) deep trace |
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
| [steam-architecture.md](steam-architecture.md) | Orientation to Steam's client: topology, how it treats shortcuts, identifiers, pointers to the detail |
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
| [steam-cartridges.md](steam-cartridges.md) | The `steam-cartridges` architecture: the hexagon, the layer docs, how to add a feature |
| [steam-cartridges/](steam-cartridges/README.md) | One doc per architecture layer, plus [verification.md](steam-cartridges/verification.md) (live baseline, rollback, open known issues) |
| [millennium-architecture.md](millennium-architecture.md) | The suite: core/provider split, data flow, RPC, provider contract. Its module layout is out of date |
| [enhanced-notifications.md](enhanced-notifications.md) | How `enhanced-notifications` is built (every toast's style, and the achievement banner merged from `enhanced-achievements`): layers, owners, the safety net, how to add a feature |

---

## 3. Roles

- **Architect** (diagnosis, planning): [steam-debug.md](steam-debug.md) and
  [steam-components.md](steam-components.md) for evidence, then a plan in
  [plans/](plans/) to [the standard](plans/README.md).
- **Implementer**: executes one plan exactly. The [plugins.md](plugins.md)
  guardrails and the plan's banned actions are non-negotiable.
- **Verifier**: [AGENTS.md](../AGENTS.md) Routines 1–3 plus the plugin's
  `tests/`, using [steam-debug.md § 7](steam-debug.md#7-cost-efficient-debugging).
