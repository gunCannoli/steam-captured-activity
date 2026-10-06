# steam-cartridges — plugin architecture

**This doc's job:** the entry point to how `steam-cartridges` is built. It says what
the plugin is, how its layers map onto a ports-and-adapters (hexagonal) system, where
each layer's detailed doc lives, and how to decide where a new feature goes. It does
not repeat the layer docs; it points to them.

Not here: what Steam itself does ([steam-architecture.md](steam-architecture.md)); the
rules for writing any plugin code ([plugins.md](plugins.md)); why the architecture is
shaped this way ([ADR-0039](decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam),
[ADR-0044](decisions.md)); the suite-level core/provider split
([millennium-architecture.md](millennium-architecture.md)).

---

## 1. What the plugin is

`steam-cartridges` gives a non-Steam game Steam's own app detail page. It restores the
sections Steam hides from shortcuts by app type and feeds Steam's own stores with
data the plugin resolves: screenshots, recordings, metadata, artwork, achievements.
It is the core of the suite and never depends on a provider plugin.

What it shows for a game with no Steam data, from what it resolves itself: Game Info, artwork, achievements, the
screenshots and recordings Steam captured, and Steam's own **Community Content** cards (IGDB trailers and images,
ScreenScraper images, and the game's **ScreenScraper manual**: its first page is a card, and opening it shows every page
in Steam's own viewer, scrolled by the D-pad or mouse wheel). The Community cards are Steam's: the plugin feeds Steam's
loader and tweaks the viewer, it does not build a page. What Steam's layout allows (card sizes, the shuffled row
templates, the viewer's text) is in [steam-components.md](steam-components.md#community-media--workshop-store); the
manual's design is [ADR-0048](decisions.md) and [steam-cartridges/service-media.md](steam-cartridges/service-media.md);
pdf.js, ScreenScraper and build facts are in [knowledgebase.md](knowledgebase.md).

**Universal Captured Activity:**
User captures (screenshots and recordings) are treated as first-class activity items across **both native Steam games and non-Steam shortcuts**. Steam hides local captures from the Activity Feed unless manually uploaded to Steam Community; `steam-cartridges` ingests genuine local captures, builds daily chronological cards with 16:9 thumbnails, enables inline clip playback, and styles headlines with `{Username} captured` across the entire library.

**Extension & Expansion System:**
The core exposes a global, typed extension registry on `window.SteamCartridges` (`frontend/kernel/extensions.ts`). External Millennium plugins can register as providers without direct code dependencies or crash risks:
- [steam-cartridges-local.md](steam-cartridges-local.md): Local Steam API emulator achievement parsing (.ini and .json for CODEX, RUNE, GSE, Goldberg) and safe resets.
- [steam-cartridges-third-party.md](steam-cartridges-third-party.md): External PC storefront integrations (Epic Games Store and Xbox / Microsoft Store / Game Pass: installed games discovery, auto-add, achievement sync, and overlay workarounds).

Two halves, one boundary:

- **Frontend** (TypeScript, in Steam's React): watches what the user does, decides,
  and writes into Steam.
- **Backend** (LuaJIT): owns data, files and the network. Reached only through RPC.

---

## 2. The hexagon

One record per shortcut (`GameRecord`) sits in the middle. Everything that talks to
the outside world is an adapter around it, and adapters never talk to each other.

```
            DRIVING adapters                         DRIVEN adapters
        (the world tells us something)          (we tell the world something)

  Steam UI ─► sensors ─┐                         ┌─► surfaces ─► Steam UI
                       ▼                         │
                 ┌──────────────────────────────────────┐
                 │  app (use cases)  ─  domain (policy) │
                 │        kernel: GameRecord, events    │
                 └──────────────────────────────────────┘
                       │
                       ▼
                 ports/backend ──RPC──► services ─► sources (IGDB, RA, Steam store…)
                 ports/image             (Lua)   └─► storage (JSON files)
```

| Hexagon role | Where | What it is |
| --- | --- | --- |
| **Core** | `kernel/`, `domain/`, `app/` | Shapes, events, the record; pure policy; use cases with injected dependencies. No Steam, no `window`, no RPC as a value |
| **Driving adapters** | `sensors/` | Detect what the user does and what Steam knows; emit kernel events or expose reads. Never write to Steam |
| **Driven adapter: Steam** | `surfaces/<name>/` | The **only** code that writes to Steam. One folder per Steam target |
| **Ports** | `ports/` (`transport.ts`, `backend.ts`, `image.ts`) | The only door to the backend and the network |
| **Driven adapter: backend** | `backend/` services, sources, stores | A service owns its data; a source fetches; a store stores |
| **Composition root** | `index.tsx` | Creates and wires everything. No logic |

The rule that makes it work: **data flows one way** (sensor → app → port → service →
record → surface) and **only surfaces write to Steam**. A surface is never read by
another layer, never fetches, and never calls another surface.

The authoritative rule tables live in
[steam-cartridges/README.md](steam-cartridges/README.md): who may import whom, and what
each layer may *do*. Both are enforced by `tests/architecture.test.ts`, not by
convention.

---

## 3. Layer docs

One doc per layer, updated by every change that touches the layer.

| Layer | Doc |
| --- | --- |
| Overview: dependency rule, layer capabilities, architecture tests, how to add a feature | [README.md](steam-cartridges/README.md) |
| Safety: kill switches, safe mode, error budget, fail-open hooks | [safety.md](steam-cartridges/safety.md) |
| Kernel: `ShortcutId`, events, `GameRecord`, `Surface` contract, Extension API | [kernel.md](steam-cartridges/kernel.md) |
| Sensors: view, lifecycle, collections, owned apps | [sensors.md](steam-cartridges/sensors.md) |
| Surfaces: one section per Steam target | [surfaces.md](steam-cartridges/surfaces.md) |
| Backend port and RPC facade | [rpc.md](steam-cartridges/rpc.md) |
| Resolver service (native match, web identity, routing policy) | [service-resolver.md](steam-cartridges/service-resolver.md) |
| Metadata service and its sources | [service-metadata.md](steam-cartridges/service-metadata.md) |
| Media service (community media) and its sources | [service-media.md](steam-cartridges/service-media.md) |
| Artwork service and its sources | [service-artwork.md](steam-cartridges/service-artwork.md) |
| Achievements service, sources, observer | [service-achievements.md](steam-cartridges/service-achievements.md) |
| Store copies (Epic, Xbox): detection, sources, accounts, auto-add | [service-store.md](steam-cartridges/service-store.md) |
| Freshness and ingestion | [service-freshness.md](steam-cartridges/service-freshness.md) |
| Settings panels and the Game Data editor | [settings.md](steam-cartridges/settings.md) |
| Expansion plugin: Local Steam emulators (.ini / .json) | [steam-cartridges-local.md](steam-cartridges-local.md) |
| Expansion plugin: Third-party storefronts (Epic Games & Xbox) | [steam-cartridges-third-party.md](steam-cartridges-third-party.md) |
| Live verification baseline, rollback, open known issues | [verification.md](steam-cartridges/verification.md) |
| Next features (Game Data editor, Media) | [plans/steam-cartridges-features-plan.md](plans/steam-cartridges-features-plan.md) |

The `app/` and `domain/` layers have no doc of their own; their rows are in the
README's layer list and their contracts are in the layer docs that consume them.

When a layer doc is added, add its row here in the same commit.

---

## 4. Adding a feature

Work out the feature's shape first, then place each piece on the layer that owns it.
If a piece seems to need two layers, it is two pieces.

### 4.1 Ask in this order

1. **Does it show something new in Steam?** That is a **surface**: a new
   `surfaces/<name>/` folder and its declared Steam targets. Surfaces read the
   record or a kernel event; they do not fetch.
2. **Does it need data the record does not carry?** Add the field to
   `kernel/record.ts` (additive), have the producing **service** fill it, and let the
   surface read it. Do not give a surface a way to fetch it.
3. **Does it need a new source of data?** That is a **backend source** behind an
   existing service (a metadata source, an achievements source, an artwork source).
   The resolver, surfaces and other services stay untouched.
4. **Does it react to something the user does in Steam?** That is a **sensor**
   emitting a kernel event. `index.tsx` subscribes the consumer to it.
5. **Is it a decision** (routing, art plan, category policy)? Put it in `domain/`
   as pure code with TS tests, and call it from an `app/` use case.
6. **Does it orchestrate** several of the above? That is an `app/` `create*` factory
   with injected dependencies, wired in `index.tsx`.
7. **Does it need a new RPC?** Add it to the backend facade, register it in
   `backend/main.lua`, and expose it only through `ports/backend.ts` (the
   architecture test fails on an unregistered call and on an unwired RPC).
8. **Does it need a setting?** A `settings/<panel>`; panels may use `domain/` types
   and validators, never surfaces or sensors.

### 4.2 What changes, what does not

| New feature | Files touched | Files not touched |
| --- | --- | --- |
| New metadata source (e.g. MobyGames) | its `src_*.lua`, the metadata source list, one settings panel | every surface, the resolver, achievements |
| New achievement source (e.g. Xenia) | its `src_*.lua`, the achievements source list | game-info, captures, sections |
| New thing shown on the page from existing data | one new surface folder and its `touches` | services, other surfaces |
| New record field | `kernel/record.ts`, the producing service, the consuming surface | everything else |
| New routing rule type | `frontend/domain/routing/policy.ts` and its TS tests | surfaces, services |

A change whose diff crosses more boundaries than its row allows must explain why in
its plan's root-cause section, or it is rejected.

### 4.3 Before you call it done

- `npm run check` and the TS tests pass. The **architecture tests** are the judge: a
  new import edge, a new capability or an unregistered RPC fails them. Never widen an
  allowlist to make them pass; an entry can only be added by a plan step with its
  reason.
- Backend change: `lua tests/test_backend.lua` (see [AGENTS.md § Routine 4](../AGENTS.md)).
- Live verification: [AGENTS.md Routines 1–3](../AGENTS.md#agent-operating-routines)
  (four views, Game A ➔ B ➔ A, the CDP scripts).
- Touching a Steam target: read its map row and trace in
  [steam-components.md](steam-components.md), and the guardrails in
  [plugins.md](plugins.md), first.
- Update the layer doc(s) you touched, and [CHANGELOG.md](../CHANGELOG.md).
- A new design decision gets an ADR in [decisions.md](decisions.md); never contradict
  one without superseding it.
