# Plan: audit the steam-cartridges migration, then close its gaps (M10)

**Status:** **Superseded for execution (2026-09-30).** The user asked for Part 2 to be detailed right away with every decision taken:
it is [steam-cartridges-m10-gap-batch-plan.md](steam-cartridges-m10-gap-batch-plan.md) (Ready, 13 patch steps, dry-run replayed), and the
decisions Q1–Q8 are answered there (§ 0) and in [ADR-0044](../decisions.md#adr-0044-steam-cartridges-layers-stay-dumb-and-a-test-checks-what-each-layer-does).
The architect verified the seeded findings while building the batch (M10 § 1 names what each step closes; F03 and F15 resolved as
exceptions, F22 kept with its reason, K20 found). **Do not execute Part 1.** This document stays as the evidence record: the findings
(§ 3), the decision register (§ 4) and the pre-M10 scan output (`steam-cartridges-architecture-audit/`, which drifts after M10 by design).
**Kind:** Part 1 is a read-only audit: it changes no product code, deploys nothing, runs nothing live. It ends in a findings doc, a
reviewed decision register and the user's answers. Part 2 is the fix batch ("M10: close the gaps"), one commit per item, each revertible.
**Written for:** Part 1, an executor who follows steps literally; Part 2, the architect who writes M10.
**Why:** the [migration plan](steam-cartridges-architecture-migration-plan.md) split the plugin into layers, and only the import ratchet
(`tests/architecture.test.ts`) enforces it. The ratchet checks **who imports whom**, not **what each layer does**, and it cannot see what
`index.tsx` injects. That is how `surfaces/artwork/artwork.ts` kept its own `fetch` (network I/O in a surface, a copy of `ports/image.ts`, a backend
fallback that writes a 4-byte image) after M3 "was done" ([artwork fetch plan](steam-cartridges-artwork-fetch-plan.md)). The dry-run of this
plan found the same pattern in 30+ more places (§ 3), and several migration decisions that were only half carried out, or carried out in a way
that re-creates the coupling they were meant to remove (§ 4).
**Goal:** (1) every place where a layer does another layer's job is listed with evidence and a class; (2) every migration decision is
marked keep / finish / amend / revert, with evidence; (3) the user decides the open design questions; (4) M10 fixes the gaps in one batch where
each item can be undone on its own; (5) the ratchet learns the rules, so the gaps cannot come back.

---

## 0. How to use this plan

| Part | Who | Output | Changes code? |
| --- | --- | --- | --- |
| Part 1 (§ 5): S0-S6 | executor | `docs/plans/steam-cartridges-architecture-audit-findings.md` (the findings doc, template in § 6) | no |
| Part 1 (§ 5): S7 | executor asks, **user** answers | § "Decisions" of the findings doc | no |
| Part 1 (§ 5): S8-S9 | executor | the final M10 item list (§ 7.2 table filled in), docs commit | no |
| Part 2 (§ 7) | architect (a later session) | `docs/plans/steam-cartridges-m10-gap-batch-plan.md`, to the [plan standard](README.md), dry-run | no (a plan) |
| M10 execution | implementer | one commit per item | yes |

Read in this order before S0: § 1 (rules), § 2 (what "revert" means here), § 3 (seeded findings), § 4 (decision register), then § 5.
Everything in § 3 and § 4 was observed on `08b2960`; the executor **verifies** it, it does not rediscover it.

### 0.1 Paths and ids used below

- `REPO` = `C:\game\millennium`; `PLUGIN` = `C:\game\millennium\steam-cartridges`; `AUDIT` = `C:\game\millennium\docs\plans\steam-cartridges-architecture-audit`.
- `SCRATCH` = your session scratchpad directory (never inside `REPO`).
- Finding ids `F01`…; decision ids `R01`…; user question ids `Q1`…; M10 item ids `A1`…; scan ids (`L1`, `D1`, `X1`, `B1`…) are the `## ` headers
  printed by [scan.sh](steam-cartridges-architecture-audit/scan.sh).
- Line numbers are those of `08b2960`. If a line moved, the scan diff (S2) shows it; use the new line.

---

## 1. The rules being audited

Sources: [README § May import / must never import](../steam-cartridges/README.md), [migration plan § 4.1-4.5](steam-cartridges-architecture-migration-plan.md#4-target-architecture),
[surfaces.md](../steam-cartridges/surfaces.md), [sensors.md](../steam-cartridges/sensors.md), ADR-0039 to ADR-0042. The last column is new: it names
the scan that checks the rule, so every rule is mechanical.

| Layer | Its one job | Must not do | Scans |
| --- | --- | --- | --- |
| `kernel/` | types, events, record store, pure containers | import anything of ours, touch Steam, `fetch`, RPC, timers, logging | L2, L3 |
| `domain/` | pure policy (routing, plans, mappings) | `window`, `SteamClient`, `fetch`, RPC, timers, logging | L2, L3 |
| `sensors/` | detect what the user does and what Steam knows; emit events or expose reads | write to Steam, call RPC, `fetch` | L4, L5, L7 |
| `app/` | decide, orchestrate, put results in the record | touch Steam or `window`, render, keep module-level singletons, import the backend port as a value | L2, L7, L13, L14 |
| `ports/` | the only door to the outside (RPC via `transport.ts`, HTTP via `image.ts`) | touch Steam, decide policy | L1, L2 |
| `surfaces/<name>/` | the only code that writes to Steam, executing what the record says | network I/O, call the backend (directly **or through an injected dep**), decide policy, call another surface (directly **or through an injected dep**), detect user activity, be read by another layer as a data source | L1, L5, L6, L8, L10, L11, L12 |
| `steam/` | shared read-only resolution: one webpack scanner, one jsx dispatcher, Steam's types | features, surfaces, settings | L6 |
| `settings/` | the settings store and the panels | write Steam, own business rules, re-evaluate policy on its own | L9, L15 |
| `index.tsx` | composition root: create and wire, **no logic** | read Steam stores, decide, fan out events | L7, L8, L15 |
| `backend/` services | resolve / fetch / store, one owner per data file, HTTP only via `net.lua` | duplicate another service's source; use an RPC module as a library; a store that also fetches | B1-B5, X4 |
| all | one definition per shape (D12), per constant, per helper; no dead code (D13) | copies, unused RPCs and exports | D1-D6, X1-X3 |

**Sanctioned exception (not a finding):** a second *listener* on a Steam method another surface already patches, declared under its own
`touches` name with a `#` suffix ([ADR-0042](../decisions.md#adr-0042-game-info-is-re-applied-from-steams-overview-rebuild-the-render-time-check-is-only-a-fallback),
[knowledgebase](../knowledgebase.md), "a second listener … must be declared under its own name"). Scan L11 lists it so that a **new** one is
seen; `collectionStore.OnAppOverviewChange#game-info-repair` is the only one on `08b2960`.

---

## 2. What "revert a bad migration decision" means here (read before § 4)

1. **No `git revert` of migration commits.** M0a-M9b are spread over the 93 commits that touch `steam-cartridges/` (`git log --oneline -- steam-cartridges | wc -l`),
   interleaved with bug fixes (K3-K19) and features (icon plan); undoing one would undo unrelated fixes. A decision is reverted **forward**: an M10 item restores the intended design, and a new
   ADR records the decision when it contradicts an accepted one (ADR-0039 to ADR-0042).
2. **Every finding records where it came from** (findings doc columns "Introduced by" and "Last carried by", § 5 S3 step 3). This separates
   gaps a migration step **created** (a decision to review in § 4) from old code a pure move **carried** unchanged (D14), so the register can
   say which *decision* caused a gap rather than which line.
3. **Every M10 item is revertible on its own** (§ 7.4): one commit per item, a base tag, an explicit "depends on" per item, no persisted
   format change, no removal of settings keys, `FEATURE_IDS` or public `index.tsx` exports without the user's answer. So if an M10 change
   turns out to be the bad decision, `git revert <sha>` undoes exactly it.

---

## 3. Seeded findings (dry-run on `08b2960`; the executor verifies each in S3)

Class codes (S5): **bug** (wrong behaviour now or a guardrail broken), **overlap** (two owners of one job, or a job in the wrong layer),
**gap** (a migration step left unfinished), **dead** (no caller, D13), **debt** (right owner, wrong shape), **docs** (a doc says something false),
**exception** (allowed; say by which rule). The class below is a proposal; S5 confirms or changes it with one line of reason.

| Id | Where (`08b2960`) | Rule broken | Evidence (scan or command) | Proposed class | Proposed M10 item |
| --- | --- | --- | --- | --- | --- |
| F01 | `surfaces/artwork/artwork.ts:21-92` (`fetchImageAsBase64`), `:117` | surface does network I/O; copy of `ports/image.ts`; backend fallback returns 4 bytes | L1; artwork fetch plan § 1 findings 1-2 | bug + overlap | A1 (planned) |
| F02 | `surfaces/achievements/store.ts:311` `if (!appData.details) appData.details = {};` | [guardrail 8](../plugins.md#8-dedicated-metadata-association-never-overwrite-appdatadetails) ("never overwrite `appData.details`"); the write is not in the surface's `touches` | L10; `sed -n 300,320p frontend/surfaces/achievements/store.ts` | bug | A12 |
| F03 | `surfaces/native-links/core.ts:87` `props.details = nativeDetails(d, native)` | looks like guardrail 8 | L10; `sed -n 70,95p frontend/surfaces/native-links/core.ts`: decide whether `props` is a copy handed to Steam's component (then **exception**) or Steam's own `appData` | exception? (verify) | — |
| F04 | `surfaces/game-info/index.ts:50` + `surfaces/library-home/index.ts` touches | two surfaces patch `collectionStore.OnAppOverviewChange` | L11 | exception (ADR-0042 listener rule) | A16 (write the rule into surfaces.md and the ratchet) |
| F05 | `index.tsx:446` (`refreshSections` into `achievements`), `:483` (`ensureAppOverviewHooked`, `trackInstance` of game-info into `playbar`), `:349` (`setContentListener(setHasContent)`: captures → sections) | a surface calls another surface; § 4.1 forbids it, the injection hides it from the ratchet | L8, L12 | overlap (decision R02) | A10 |
| F06 | `index.tsx:427-440` (`artwork` gets `downloadImage`, `recordArtwork`, `saveIcon`, `recordIcon`), `:500` (`library-home` gets `loadLibraryStats`) | a surface calls the backend through injected deps (§ 4.1: surfaces never reach `ports/`) | L8; `frontend/surfaces/artwork/deps.ts` | overlap (decision R02, Q1) | A1 (`downloadImage`), A9 (the rest) |
| F07 | `index.tsx:100-113` `serviceAllowed`, `:122-136` `titleOf`/`shortcuts` reading `appStore`, `:151-158` a second `titleOf`, `:183-188` `resolveNative` with a backend fallback, `:256-279` store-hook retry loop + fake-achievement window hook, `:454-471` unlock fan-out, `:524-533` launch/quit bookkeeping | "composition root only, no logic" (§ 4.1) | L7, D5, L15; read `index.tsx` | overlap | A5, A8 |
| F08 | `index.tsx:125`, `index.tsx:153`, `steam/shortcut.ts:9` | three shortcut-title readers (a sensor's job, § 4.5) | D5 | overlap | A5 |
| F09 | `app/controller.ts:42-44`, `app/routing.ts:100`, `settings/panels/audit.tsx:139-179`, `surfaces/achievements/store.ts:149-373`, `surfaces/game-info/patch.ts:20-32,164-171,295-296`, `surfaces/game-info/metadata.ts:107-223` | triple-key lookups (`get(a) ?? get(a >>> 0) ?? get(a \| 0)`): migration § 1.5 root cause, which `kernel/appid.ts` was built to make impossible (kernel.md "What it owns") | L9 | gap (R11) | A3 |
| F10 | `steam/gameid.ts:22-26` `gameIdFromAppId`, used by `surfaces/captures/publish.ts:3` | copy of `kernel/appid.ts` `toGameId` (kernel.md: "the gameid rule lives in one place") | L9 | overlap | A2 |
| F11 | `domain/routing/policy.ts:45`, `surfaces/native-links/core.ts:14` (`SHORTCUT_MIN`), `index.tsx:134`, `sensors/owned-apps/index.ts:18` (literal `0x8000_0000`) | copies of `kernel/appid.ts` `NON_STEAM_APPID_MIN` / `isShortcutAppId` | D1, L9 | overlap | A2 |
| F12 | 9 declarations of the route shape: `app/{achievements,artwork,identity,ingest,metadata,steam-store,view}.ts`, `kernel/record.ts:150`, `ports/backend.ts:72` | D12 (shapes live in the kernel, once) | D3 | gap (R08) | A2 |
| F13 | `OwnedCandidate` (`ports/backend.ts`, `sensors/owned-apps/index.ts`), `ControllerContext` (`app/controller.ts`, `surfaces/game-info/category-policy.ts`), `SyncProgress` (`app/ingest.ts:15`, `settings/settings.ts:11`) | D12; the copies exist because D3 forbade a type import across layers (sensors.md says so for `OwnedCandidate`) | D2 | gap (R08) | A2 |
| F14 | `findJsxRuntime` + `JsxRuntimeModule` in `steam/gamepad-appid.ts:52-68`, `surfaces/captures/activity-cards.ts:9,166`, `surfaces/captures/headline.ts:7,25`, `surfaces/native-links/index.ts:225`; `findModuleByExport` in those three surfaces | [guardrail 3](../plugins.md#3-single-pass-webpack-module-pre-caching) (one scanner, `steam/modules.ts`) and ADR-0041 (one jsx dispatcher in `steam/`); K13 fixed only `getSteamRequire` | L6, D1, D2 | overlap | A4 |
| F15 | `surfaces/captures/bpm-style.ts:11` `onPopupCreate` | detection outside `sensors/` (§ 4.5); the view sensor registers its own `onPopupCreate` too | L5 | exception? (Q7) | A16 or A5 |
| F16 | `app/steam-store.ts:10-53` | D3 setters **inside `app/`** (`setIdentitySource`, `setMetadataSource`, `setArtworkSource`) for app→app wiring; `setGameInfoRefresher` = app calls a surface directly, around the record; module-level state; imports `backend` as a value | L12, L13, L14 | debt + overlap | A6 |
| F17 | `app/controller.ts:1-47` | module singleton, imports `backend` as a value, triple-key lookup, structural copy of a surface type; the controller context reaches `game-info` outside the record (`index.tsx:478`) | L9, L13, L14, D2 | debt | A6 |
| F18 | `app/identity.ts:14`, `app/artwork.ts:17` (`RETRY_MS = 5 min`, same `resolved`/`inflight`/`retryAt` memo copied) vs `backend/fresh_policy.lua:25` (`error = 30 min`) | freshness lives in the backend (§ 11 decision 1); two retry policies for one rule, in two layers, with different values | D4, D1 | overlap (Q5) | A7 |
| F19 | `surfaces/achievements/store.ts:365-373` `getLocalAchievements`/`getLocalSchema`/`getLocalUnlocks` read by `index.tsx:284,337` (the settings panel's `records.achievementsOf` reads the **surface**) | a surface is used as a data source; `record.achievements` is the read model (§ 4.2) | `git grep -n "getLocalAchievements\|getLocalSchema" -- frontend` | overlap | A11 |
| F20 | `window` CustomEvent `steam-cartridges:rule-updated`: `settings/panels/rules.tsx:174,182,195` dispatch, `settings/panels/audit.tsx:101` listens, `index.tsx:234` dispatches for `app/ingest` | a second event bus beside `kernel/events.ts` (which has `settings.changed`) | L15 | overlap | A13 |
| F21 | `getGameRecord` in `ports/backend.ts` (no caller) and RPC `GetGameRecord`; RPC `GetArtworkForGame` (superseded by `art_service` in M5c); RPC `SteamStoreGetAppDetails` (only `tests/test_steam_store.lua` calls it); `app/ingest.ts:74` `removeLegacySyncHistory` (a one-shot M9a cleanup, "can go in a later release"); `surfaces/game-info/patch.ts:41` `setEnricher` (check if it is a cycle-breaker or dead indirection) | D13; **F1 deletes `SaveGameMetadata`, F2 owns the four `GetGame*` media RPCs, F1 owns `SteamStoreRejectSuggestion`: not dead** | X1, X2, L12; [features plan](steam-cartridges-features-plan.md) F1/F2 rows | dead | A15 |
| F22 | `backend/shortcut_icon.lua:40-50` `download()` (net.get of a binary, and `web_sgdb.download_image` `:96`) | the same NUL-byte class as F01 finding 2; `sniff` rejects a body under 100 bytes, so it fails closed, but it is a fallback nothing should reach | X4 | dead (bug class) | A14 |
| F23 | `backend/metadata_service.lua:16` `require("web_rpc")` (for `get_shortcut_info`, `:40`) | a service uses an RPC module as a library (RPC modules are thin facades) | B1 | debt | A14 |
| F24 | `backend/achievements_store.lua:129-160` (`default_http_get`, Steam web schema and global %) | a persistence module is also a network source ("one owner per data"; § 4.3 splits stores from sources) | B3 | overlap | A14 |
| F25 | backend source contract `{ id, supports, fetch }` (§ 4.3) used only by `ach_service.lua` (4 sources); `metadata_service`, `art_service` hard-code their order; § 4.3 file names (`src_*`, `metadata_*`) never adopted | § 4.3 as designed vs as built; the provider-plugin path (ADR-0012/13/14) depends on the contract | B4; `git ls-files backend` | gap (R13, Q3) | A14 or ADR only |
| F26 | `settings/{context,defaults,settings}.ts`, `settings/panels/{audit,rules}.tsx` import `domain/routing/policy`; `audit.tsx:6` calls `isServiceAllowed` itself (a second evaluation site beside `index.tsx:100`) | README § 4.1 row: settings may import `kernel`, `ports` only; `LAYER_RULES` allows `settings -> domain` | edges (S1 step 6); `git grep -n "domain" -- frontend/settings` | docs + overlap (Q4) | A8, A16 |
| F27 | `docs/steam-cartridges/rpc.md`: `SteamStoreGetAppDetails` "live", `GetArtworkForGame` "unwired → M5c", `SteamStoreDownloadImage` "live"; `ports/transport.ts:1-2` comment names `rpc.ts` (deleted in M9a) | rpc.md's own rule ("a step that rewires an RPC updates this table") | X1; `sed -n 1,3p frontend/ports/transport.ts` | docs | A15 |
| F28 | `library-home` reads no record part (`surfaces.md`: "not decided — an RPC call until M7 (D4)"); M7 is done and nobody decided | D4 left open | `surfaces.md` § library-home; L8 | gap (R03) | A9 |
| F29 | `surfaces/game-info/category-policy.ts` (107 lines, pure policy, imported by `tests/category-policy.test.ts` and `tests/routing-rules.test.ts`); `app/artwork.ts:58` `buildPlan` (pure) | policy in a surface; pure plan-building in `app/` (both belong in `domain/`) | `git grep -n "category-policy\|buildPlan" -- frontend tests` | debt | A2 |
| F30 | 6 module-level `deps` objects mutated by `create*Surface` (`surfaces/{achievements/store,artwork/deps,captures/deps,game-info/deps,library-home/grid,toasts/deps}.ts`) | each surface is a hidden singleton; a second `create*Surface` silently rewires the first | D1 | debt (low) | later (TASK.md) |
| F31 | `https://cdn.akamai.steamstatic.com` built in `backend/art_service.lua` and `frontend/domain/steam-cdn.ts` | two builders of the same Steam CDN URLs, one per runtime | D6; read both | overlap? (verify) | A15 or exception |
| F32 | `test_backend.lua` expects 213 screenshots / 6 games with media; the live library has 214 / 7 | not a code gap: the fixture tracks the library (AGENTS Routine 4) | § 5 S0 P5 | exception (library drift) | the user refreshes the fixture when convenient |

---

## 4. Decision register: every migration decision, as intended vs as built

The executor verifies the "As built" column in S6 (each cell names its evidence) and may change a verdict only with one line of evidence.
Verdicts: **keep** (worked), **finish** (right decision, left half done), **amend** (right intent, the rule needs a change: an ADR),
**revert** (the decision itself was wrong: an ADR supersedes it, then an M10 item undoes its effect).

| Id | Decision (source) | As intended | As built (`08b2960`) | Findings | Proposed verdict |
| --- | --- | --- | --- | --- | --- |
| R01 | Import rule + ratchet (§ 4.1, D1, M0c) | the rule is enforced by a test | the import graph is clean (allowlist `[]`, 48 edges, all rule-allowed) **but** the rule is checked only on `import` lines: globals, `fetch` and injected deps pass | F01, F05-F07 | **amend**: add the capability ratchet (A17); no ADR (a check gets stronger) |
| R02 | D3 composition-root injection (setters, structural types) | a **migration bridge**: "keeps one module moves per step", replaced by a record read when the data step lands | became permanent; injection now carries edges § 4.1 forbids (surface → surface, surface → backend), and within `app/` it replaced plain factory arguments | F05, F06, F13, F16 | **revert the permanence**: after M10 a surface may be given only `SurfaceDeps`, pure reads of the record, settings or a sensor, never a function that calls `ports/` or another surface; effects go through kernel events. ADR-0044 (amends ADR-0039 § D3) |
| R03 | D4: M3 moves ownership, M4-M7 move data | every surface ends record- or event-driven | `library-home` still calls an RPC from `install`; captures → sections content flag still a setter ("kept, by design", § 7.9, no ADR) | F28, F05 | **finish** (decide both, Q1/A9/A10) |
| R04 | D5: record updates reach surfaces through `app/render-queue.ts` on a timer | no store write on a Steam render stack | `runner.render` has one caller, `index.tsx:143` (the queue) | — | **keep** (verify: `git grep -n "runner.render" -- frontend`) |
| R05 | D6: every hook fail-open | a throw returns Steam's own result | per-surface checklist (S4, question S-b) | — | **keep** unless S4 finds a hook without a fallback |
| R06 | D7: `touches` naming, disjoint targets | one owner per Steam target | holds; the `#listener` rule lives only in the knowledgebase, not in D7 or surfaces.md | F04 | **amend docs** (A16) |
| R07 | D8: `index.tsx` exports are public API "until M9" | names kept for CDP scripts and the settings alias block | M9 kept them; several carry logic (`initAchievements`, `loadAchievementsForApp`, the fake-achievement hook) | F07 | **amend**: exports stay (never remove without Q-answer), each becomes a one-line delegation to `app/`; list them with their consumers in README |
| R08 | D12: payload shapes live in the kernel | one definition per shape | route shape ×9, `OwnedCandidate` ×2, `ControllerContext` ×2, `SyncProgress` ×2 | F12, F13 | **finish** (A2) |
| R09 | D13: dead code purged, temporary code marked and deleted | nothing unused survives M9 | `getGameRecord`/`GetGameRecord`, `GetArtworkForGame`, `SteamStoreGetAppDetails`, `SteamStoreDownloadImage`, `removeLegacySyncHistory`, backend binary downloads; rpc.md stale | F21, F22, F27 | **finish** (A1, A14, A15), and let the ratchet guard it (X1/X2 in A17) |
| R10 | D14: migration steps are pure moves; bugs get their own plan | no behaviour change hidden in a move | held; F02 is a bug of this kind (moved verbatim in M3.5) | F02 | **keep**; F02 is its own M10 item with its own live check (A12) |
| R11 | § 1.5 / § 4.2: one appid brand, "every map keyed by `ShortcutId`" | triple-key lookups impossible | the brand exists and is used by `app/view`, sensors and records; `surfaces/achievements`, `surfaces/game-info`, `app/controller`, `app/routing`, `settings/panels/audit` still probe three keys | F09-F11 | **finish** (A2, A3): our maps use `ShortcutId`; a Steam API that needs a signed id gets `toSignedKey` |
| R12 | § 4.2: `GameRecord.route` and `media` parts | the route is part of the record | `route` is declared and never written; the route is passed as an argument to every `ensure` (and re-declared 9 times); `media` waits for F2 | F12 | **amend or finish**, Q2: write `route` into the record in `app/view` (finish) or drop it (removing a record field needs an ADR, § 4.2). `media`: **keep** for F2 |
| R13 | § 4.3: backend services as `registry_*`/`resolve_*`/`metadata_*`/`ach_*`/`fresh_*` files, sources as `src_*.lua` with one source contract | a source can later move out to a provider plugin | contract used by `ach_service` only; `metadata_service` needs `web_rpc`; `achievements_store` is store + source; the file names were never changed | F23-F25 | **amend**, Q3 (recommended: ADR-0044 records the as-built layout and makes the source contract binding for the next source only, plus the two fixes F23, F24) |
| R14 | § 4.4: surfaces only write; "a surface never triggers a fetch" | surfaces execute the record | `artwork` fetches and calls the backend four ways; `library-home` calls an RPC; `achievements` is read as a data source; `category-policy.ts` decides in a surface | F01, F06, F19, F28, F29 | **finish** (A1, A9, A11, A2) |
| R15 | § 4.5: sensors are the only detectors | one owner per observation | `index.tsx` reads titles and the shortcut list from `appStore`; `captures/bpm-style.ts` registers its own `onPopupCreate` | F07, F08, F15 | **finish** (A5); Q7 for `bpm-style` |
| R16 | § 11 decision 1: pipeline and freshness in the backend | the frontend asks, the backend's TTLs decide | the frontend keeps its own 5-minute error retry in two copies | F18 | **finish** (A7, Q5) |
| R17 | ADR-0040: routing policy is pure TS in `domain/routing` | one evaluation of the policy | two evaluation sites (`index.tsx:100` `serviceAllowed`, `settings/panels/audit.tsx` `isServiceAllowed`) | F26 | **keep** the ADR; **finish**: one `app/routing` function used by both (A8) |
| R18 | ADR-0041: one jsx hook per concern, shared infrastructure in `steam/` | one dispatcher, one lookup | four copies of `findJsxRuntime` | F14 | **finish** (A4) |
| R19 | ADR-0042: Game Info repair from `OnAppOverviewChange` | trigger first, render as fallback | as designed; `viaRender` is its live check | F04 | **keep** |
| R20 | README § 4.1 settings row (`kernel`, `ports`) vs `LAYER_RULES` (`settings -> domain` allowed since M4a) | one rule | the doc and the test disagree | F26 | **amend**, Q4 (recommended: allow `settings -> domain` for types and validators, never policy evaluation; update README) |
| R21 | `safety/` has no § 4.1 row; safety.md: only `index.tsx` may import it | a rule in the table | holds (the only edge is `index -> safety`) | — | **keep**; add the row (A16) |
| R22 | § 4.1 "`index.tsx`: composition root only, no logic" | wiring only | ~120 lines of logic (F07) | F07 | **finish** (A5, A8) |

---

## 5. Part 1: steps (executor)

Run every command in **Git Bash** (the Bash tool) unless it says PowerShell. After each step, compare with the expected output **exactly**.
Write everything you find into the findings doc (template § 6) as you go; never into chat only.

### S0. Preconditions

From `PLUGIN` (`cd /c/game/millennium/steam-cartridges`):

| # | Command | Expected |
| --- | --- | --- |
| P1 | `git -C /c/game/millennium status --short` | prints nothing |
| P2 | `git log -1 --format=%h` and `git diff --stat 08b2960 HEAD -- frontend backend tests` | any hash; the diff prints nothing. **If it prints files:** the code moved on since the dry-run (F1 or A1 may have run). Continue, and in S2 treat every scan diff line as expected drift to classify, not as an error. Write the `--stat` output into the findings doc § Baseline |
| P3 | `npm run check` | `> steam-cartridges@0.1.0 check`, `> tsc --noEmit`, then nothing; exit 0 |
| P4 | `npm run test:ts` | its summary contains `ℹ tests 160`, `ℹ pass 160`, `ℹ fail 0` (if P2 printed files: any pass count, `ℹ fail 0`) |
| P5 | the Lua block below | exactly the table below |

```bash
export NSGA_STEAM_ROOT=C:/game/steam
for t in test_backend test_steam_store test_migrate test_identity test_metadata_service test_art_service test_ach_service test_freshness test_emulator_controllers; do
  o=$(lua tests/$t.lua 2>&1); echo "$t: $(echo "$o" | grep -c '  PASS') PASS, $(echo "$o" | grep -c '  FAIL') FAIL, last: $(echo "$o" | tail -1)"
done
NSGA_STEAM_ROOT=C:/game/steam lua tests/test_backend.lua 2>&1 | grep '  FAIL'
```

Expected (`08b2960`, library of 2026-09-30):

```
test_backend: 77 PASS, 3 FAIL, last: 3 FAILURE(S)
test_steam_store: 84 PASS, 0 FAIL, last: ALL PASS
test_migrate: 7 PASS, 0 FAIL, last: ALL PASS
test_identity: 18 PASS, 0 FAIL, last: ALL PASS
test_metadata_service: 49 PASS, 0 FAIL, last: ALL PASS
test_art_service: 59 PASS, 0 FAIL, last: ALL PASS
test_ach_service: 19 PASS, 0 FAIL, last: ALL PASS
test_freshness: 43 PASS, 0 FAIL, last: ALL PASS
test_emulator_controllers: 25 PASS, 0 FAIL, last: ALL PASS
  FAIL  non-steam games with media  -> 7
  FAIL  screenshots indexed  -> 214
  FAIL  library_stats covers every media game  -> 7
```

The three `test_backend` FAIL lines are **library fixtures** (F32: the user took screenshots of a seventh game; the fixture says 6 and 213).
The numbers after `->` may grow again (more screenshots): that is fine. **Any other FAIL line, or a FAIL in another suite, is a stop** (§ 10).
Do not edit the fixture (§ 9).

If P1, P3 or P4 does not hold, stop (§ 10).

### S1. Baseline record

Create the findings doc from the template in § 6 (`docs/plans/steam-cartridges-architecture-audit-findings.md`) and fill § Baseline with:
the P2 hash and diff stat, the P3-P5 outputs, and the import edges:

```bash
node --experimental-strip-types -e "import('file:///C:/game/millennium/steam-cartridges/tests/architecture.test.ts').then(m => { for (const e of m.computeEdges()) console.log(e, m.ruleAllows(e) ? '' : 'NOT-RULE') })" 2>/dev/null | grep -- '->'
```

Expected: 48 lines, none ending in `NOT-RULE` (the first is `app -> domain `, the last `surfaces/toasts -> steam `). The node test runner also prints
its own test report after the list; the `grep` keeps only the edges.

### S2. Mechanical scans

```bash
export SCRATCH='<your scratchpad directory, with forward slashes>'
bash ../docs/plans/steam-cartridges-architecture-audit/scan.sh > "$SCRATCH/scan.txt"
diff ../docs/plans/steam-cartridges-architecture-audit/scan-expected.txt "$SCRATCH/scan.txt"; echo "diff exit $?"
```

Expected: `diff exit 0` (no output before it). If P2 printed files, the diff may print lines: copy **every** diff line into the findings doc
§ Scan drift, then classify it: a `>` line is a new hit (it becomes a new finding `F33`… in S5 unless it is one of § 3's findings at a new
line number), a `<` line is a hit that is gone (note which finding it resolves). Never edit `scan-expected.txt`.

### S3. Verify the seeded findings

For each row F01-F32 of § 3, in order:

1. Run its evidence (the scan id: find the lines in `$SCRATCH/scan.txt`; or the command in the row).
2. Mark it in the findings table: **Confirmed** (the evidence shows exactly what the row says), **Changed** (it shows something else: write
   what), or **Rejected** (the rule does not apply: one line why, citing a rule, ADR or guardrail).
3. Fill "Introduced by" and "Last carried by", from `PLUGIN`, where `<needle>` is a short literal from the offending line and `<file>` its
   current path (`frontend/…` or `backend/…`):
   - Introduced by: `git log --follow --format="%h %s" -S"<needle>" -- <file> | tail -1` (the true origin, across renames).
   - Last carried by: `git log --format="%h %s" -S"<needle>" -- <file> | tail -1` (the commit that put it at this path: for a moved file, the
     migration step that moved it).
   Example (F02, observed): Introduced by `325e757 fix(cartridges): resolve Animaniacs achievements, …` (pre-migration); Last carried by
   `327cbde refactor(steam-cartridges): achievements surface (M3.5)`. A finding whose "Introduced by" is a migration step points at a **decision**
   (§ 4); one that was only carried by a migration step points at a pure move that kept an old bug (D14).

Specific instructions:
- **F03:** read `frontend/surfaces/native-links/core.ts` lines 60-100. If `props` is an object this code builds and hands to Steam's component,
  and not `appDetailsStore.GetAppData(...)`'s object, mark Rejected ("props copy, not appData; guardrail 8 protects appData").
- **F15:** read `frontend/surfaces/captures/bpm-style.ts` fully. Record whether it only injects a `<style>` into the popup's document (a write
  target) or also decides anything. Leave the class to Q7.
- **F21 `setEnricher`:** `git grep -n "setEnricher\|enricher" -- frontend/surfaces/game-info`. If `patch.ts` uses it only to avoid importing
  `metadata.ts` (an import cycle), mark "debt: cycle-breaker" instead of dead.
- **F31:** read `frontend/domain/steam-cdn.ts` and the `cdn.akamai` lines of `backend/art_service.lua`. Same slot → same URL built in both = overlap;
  different purposes = Rejected with the purpose of each.

### S4. Read-through (judgement, capped)

Only these files, only these questions. One row per file in the findings doc § Read-through: "clean" or the finding ids it raised (new ids
continue after the last one used). Do not read other files; do not follow imports.

**Surfaces** (each folder under `frontend/surfaces/`: achievements, artwork, captures, game-info, library-home, native-links, playbar, sections,
toasts). For each folder:
- S-a *Touches complete?* List every Steam write in the folder (`git grep -nE "\.m_[A-Za-z]+\s*[.=]|SteamClient\.[A-Za-z]+\.[A-Z]|\] = function|afterPatch\(|beforePatch\(|replacePatch\(|AppDetailsChanged|\.details\s*=" -- frontend/surfaces/<name>`)
  and check each against the `touches` list in its `index.ts`. A write with no entry is a finding (class docs, or bug if it writes a target
  another surface owns).
- S-b *Fail-open?* For each hook site from S-a, is it inside a `try` whose `catch` returns Steam's original and calls `reportError` with
  this surface's id (or its part's id, D6)? A hook without one is a finding (class bug).
- S-c *Decides?* Does `render()` or a hook choose *what* to show (a filter, a priority, a fallback) that the record did not state? Pure mapping to
  Steam's shapes is the surface's job; choosing is policy (`domain/`). F29 is the known case.
- S-d *Read by others?* `git grep -n "from \"./surfaces/<name>\"" -- frontend/index.tsx` and every name it imports: which of them return
  data (not install, render or diagnostics)? Each is a finding like F19.
- S-e *Calls out?* Any dep (its `deps.ts` or the `create*Surface({...})` block in L8) that reaches `backend`, `fetch` or another surface.
- S-f *Detects?* `onPopupCreate`, `onLocationChange`, route or focus watching.

**App** (`frontend/app/*.ts`, 12 files). For each file:
- A-a *Touches Steam or `window`?* (L2, L7).
- A-b *Pure policy that belongs in `domain/`?* A function with no deps and no state (F29 `buildPlan` is the known case).
- A-c *Duplicates a backend policy?* A TTL, a matcher, a source order (F18 is the known case).
- A-d *Factory with injected deps?* Or module state and direct imports (F16, F17).
- A-e *Writes the record only through `records.update`?*

**Backend** (`resolve_identity`, `metadata_service`, `art_service`, `ach_service`, `fresh_policy`, `registry`, `net`, `record_rpc`,
`steam_store_rpc`, `web_rpc`, `rpc`, `achievements_rpc`, `achievements_store`, `steam_store_store`, `web_metadata_db`). For each module:
- B-a *Owns which data file?* (B5). Does any other module write that file? (`git grep -n "<file name>\|<store module>\.save\|write_file" -- backend`)
- B-b *HTTP only via `net`?* (B2 is empty on `08b2960`; confirm no `io.popen("curl` or similar: `git grep -n "popen" -- backend`).
- B-c *An RPC module that holds logic?* An `RPC.X = method(...)` body longer than parse → call one service → return is a finding (class debt).
- B-d *Source contract?* Which sources does it use, and are they a list of `{ id, supports, fetch }` (F25)?

Write the **one-owner-per-data table** (the skeleton's open question) into the findings doc from B-a: `file | owner module | other writers | readers`.

### S5. Classify

For every finding (seeded and new): set the class (§ 3 codes) and the M10 item (§ 7.2) it belongs to, or "later" (TASK.md) for **debt** that no
item covers, or "none" for **exception**/**Rejected**. A **bug** always gets an item. Sort the findings table by item.

### S6. Verify the decision register

For each row R01-R22 of § 4: check its "As built" cell against the findings (the ids it names) and, where it names a command, run it.
Copy the row into the findings doc § Decision register with a "Verified" column: `yes` or the corrected text. Keep the proposed verdict unless the
evidence contradicts it; if you change a verdict, give the evidence in one line. Add a row for any decision a **new** finding points to.

### S7. User decision gate (stop and ask)

Ask the user the questions below with the AskUserQuestion tool, **four per call** (two calls). Each question's first option is the
recommendation. Record every answer verbatim, with the date, in the findings doc § Decisions. If you cannot ask (a non-interactive run), stop
here: write the questions into [TASK.md](../../TASK.md) § Now under this plan's line and exit (this is not a failure).

| Id | Question | Options (first = recommended) | Why it matters |
| --- | --- | --- | --- |
| Q1 | How does a surface tell the backend what it wrote (artwork slots, icon), and where do library stats come from? (F06, F28) | (a) the surface emits a kernel event (`artwork.applied`, `icon.applied`), `app/artwork` records it through the port; the icon file is saved by `app/artwork` *before* the record update so the plan carries `icon.path`; library stats become app-loaded data given to `library-home` as a pure read · (b) keep the write-back callbacks as a documented exception to § 4.1 | decides R02 and whether A9 is large or small |
| Q2 | The record's `route` part is never written. (R12) | (a) `app/view` writes `route` into the record and the `ensure` functions read it (deletes 8 shape copies) · (b) remove `route` from `GameRecord` (needs an ADR) | size of A2/A7 |
| Q3 | Backend layout (§ 4.3: `src_*` files, one source contract) was never adopted. (R13) | (a) an ADR records the as-built layout; the source contract binds new sources only; fix F23 and F24 · (b) restructure every service to the § 4.3 layout now | the provider-plugin path vs churn |
| Q4 | May `settings/` import `domain/`? (R20) | (a) yes, for types and validators; never to evaluate policy (panels ask `app/routing` through `PanelContext`) · (b) no: everything through `PanelContext` | README vs test disagree today |
| Q5 | After a failed lookup, when does the frontend ask the backend again? (F18) | (a) on the next view; the backend's `error` TTL (30 min) answers from disk until then, so no network is wasted; drop `RETRY_MS` · (b) keep a frontend retry, but one constant shared by all `app/` resolvers | one freshness policy, or two |
| Q6 | F1 (Ready) and M10 both edit `backend/main.lua`, `steam_store_rpc.lua`, `web_rpc.lua`, `ports/backend.ts`. Which runs first? | (a) F1 first, then M10 is written against the tree after F1 · (b) M10 first, F1's patches are regenerated | stale before-blocks otherwise |
| Q7 | `captures/bpm-style.ts` watches popups itself to inject a style. (F15) | (a) documented exception: a surface may subscribe to popup creation only to write into that popup · (b) the view sensor emits a `window.opened` event and the surface subscribes | purity vs a second event type |
| Q8 | `index.tsx` public exports that carry logic (R07): may M10 change their behaviour or remove any? | (a) keep every name and behaviour; the body becomes a one-line call into `app/` · (b) the user lists exports to delete | CDP scripts and the settings alias block use them |

### S8. Final M10 item list

Fill the **Status** and **Findings** columns of § 7.2 from S5 and the answers: an item with no confirmed finding becomes "dropped"; an answer
that removes work shrinks the item (write how). Add items for new bug/overlap clusters (`A18`…). Do **not** write before/after blocks: that is
the architect's job in the M10 plan.

### S9. Docs and commit

1. This plan: set **Status** to "Part 1 done (<date>); Part 2 waiting for the architect", and fill § 7.2.
2. [TASK.md](../../TASK.md) § Now: replace this plan's paragraph with one line: "Audit Part 1 done; M10 batch plan to be written from
   [findings](docs/plans/steam-cartridges-architecture-audit-findings.md)".
3. [CHANGELOG.md](../../CHANGELOG.md): one new first bullet: `**steam-cartridges: migration audit Part 1 (<date>)**: <n> findings (<bugs> bugs,
   <overlaps> overlaps, <gaps> gaps, <dead> dead), <k> decisions to amend or finish, user decisions Q1-Q8 recorded. Findings: [link].`
4. Commit (docs only, § 11) and push.

---

## 6. Findings doc template (S1 creates it)

```markdown
# steam-cartridges migration audit: findings

**Audit plan:** [steam-cartridges-architecture-audit-plan.md](steam-cartridges-architecture-audit-plan.md) · **Tree:** <hash> · **Date:** <date>

## Baseline
<P2 hash + diff stat, P3-P5 outputs, S1 edges count>

## Scan drift
<S2 diff lines and their classification, or "none (diff exit 0)">

## Findings
| Id | Where | Rule broken | Evidence | Verified | Introduced by | Last carried by | Class | Item |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

## Read-through
| File or folder | Questions | Result |
| --- | --- | --- |

## One owner per data (backend)
| File | Owner | Other writers | Readers |
| --- | --- | --- | --- |

## Decision register
| Id | Decision | As built | Verified | Verdict | Evidence for a changed verdict |
| --- | --- | --- | --- | --- | --- |

## Decisions (the user)
| Id | Answer (verbatim) | Date |
| --- | --- | --- |
```

---

## 7. Part 2: the M10 batch (design for the architect)

Part 2 finishes what the migration set out to do: each gap is a **gap in the migration's execution**, so it is fixed as a migration step
("M10: close the gaps"), in one cohesive batch (the user, 2026-09-29), not as stray feature plans.

### 7.1 Batch rules

1. **Order:** kernel and `steam/` first, then sensors, `app/`, surfaces, backend, dead code, docs; the ratchet extension (A17) **last**, seeded
   with whatever the batch could not fix. An item may move earlier only if its "Depends on" allows.
2. **One commit per item**, message `m10(A<n>): <what>` + the attribution line. Steps that leave `tsc` red (like A1 steps 3-5) are inside one
   commit. No squash, no amend after push, no rebase of pushed M10 commits.
3. **Shared preconditions** (one block for the batch, from § 5 S0, with the counts observed when the M10 plan is dry-run) and **per-item** unit
   test expectations (exact `ℹ pass N` after each item).
4. **One live verification** for the batch, after the last item, plus each item's own live checks (listed per item below). The implementer does
   not run live checks unless the M10 plan says so; the verifier runs [migration plan § 0.5](steam-cartridges-architecture-migration-plan.md#05-live-verification-the-baseline-every-step-must-reproduce),
   `npm run test:live`, AGENTS Routines 1-3.
5. **Plans that edit the same files are reconciled first** (Q6; A1 § 0 decision 2): F1 edits `main.lua`, `steam_store_rpc.lua`, `web_rpc.lua`,
   `ports/backend.ts`, `tests/test_steam_store.lua`. The M10 plan's before-blocks are copied from the tree **after** whichever runs first.
6. **The migration plan gets a closing row** (M10 in its § 0.2 status board) and the CHANGELOG one bullet per item when the batch is
   live-verified.
7. **ADR-0044** (drafted by the architect before any code, accepted by the user) records every **amend**/**revert** verdict of § 4 that
   contradicts ADR-0039 to ADR-0042: R02 (D3's permanence), R12 if Q2 = (b), R13, R20, and Q1/Q7 exceptions if chosen.

### 7.2 Proposed items (S8 fills Status and Findings)

| Id | Layer | What | Findings | Depends on | Item's own live check | Status |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | ports, app, kernel, surface, backend | artwork fetch leaves the surface; `SteamStoreDownloadImage` removed. Detail plan: [steam-cartridges-artwork-fetch-plan.md](steam-cartridges-artwork-fetch-plan.md) (needs its dry-run first, its § 9; its P5 `test_backend: 78` is now library-drifted, see F32) | F01, F06 (part) | — | its § 7 | planned (draft) |
| A2 | kernel, domain | shapes and constants into the kernel: `Route` (Q2), `OwnedCandidate`, `ControllerContext`, `SyncProgress`; `NON_STEAM_APPID_MIN`/`isShortcutAppId` replace `SHORTCUT_MIN` and literals; `steam/gameid.ts` removed for `kernel/appid.toGameId`; `category-policy.ts` and `buildPlan` move to `domain/` (D11: tests change only their import path) | F10-F13, F29 | — | none (types and pure moves); § 0.5 baseline | proposed |
| A3 | app, settings, surfaces | our maps keyed by `ShortcutId`; Steam API calls use `toSignedKey`/`toUnsigned`; no triple-key lookup outside `kernel/` | F09 | A2 | § 0.5 + Achievements and Game Info tabs on AM2R, WUCHANG, Jotunnslayer (signed and unsigned appids) | proposed |
| A4 | steam, surfaces | one `findJsxRuntime` in `steam/` (next to `jsx-hook.ts`); surfaces stop calling `findModuleByExport` | F14 | — | `headlineJsxDiagnostics`, `activityCardsJsxDiagnostics`, `nativeSectionsDiagnostics` unchanged; `check_all_tabs.js` | proposed |
| A5 | sensors, index | a `sensors/shortcuts` read (title, shortcut list) replaces the two `titleOf`, `shortcuts()` and `steam/shortcut.ts`; Q7 decides `bpm-style` | F07 (part), F08, F15 | A2 | Big Picture thumbnails (Routine 1 item 2), bucket report unchanged | proposed |
| A6 | app | `app/steam-store.ts` and `app/controller.ts` become `create*` factories with injected `backend`; the D3 setters inside `app/` go; the game-info refresh (guardrail 11) is triggered by the record, not by `setGameInfoRefresher` | F16, F17 | A2 | guardrail 11: map a shortcut by hand, Game Info re-renders in every window | proposed |
| A7 | app | one session memo for `app/identity` and `app/artwork`; retry follows Q5 | F18 | A6 | `node tests/live/probes/http_calls.mjs` shows no extra calls on a nav cycle | proposed |
| A8 | app, index, settings | the logic in `index.tsx` moves to `app/` (`resolveNative`, unlock fan-out, launch/quit bookkeeping, store-hook retry); one `serviceAllowed` in `app/routing`, used by `index.tsx` and by the audit panel through `PanelContext`; public exports stay (Q8) | F07, F26 (part) | A5, A6 | settings panel (`check_settings_panel.mjs`), launch toast, unlock toast (`probes/toast_live.mjs`) | proposed |
| A9 | surfaces, app | surface → backend calls leave the surfaces per Q1 (`artwork` write-back, `library-home` stats) | F06, F28 | A1 | artwork plan § 7 items 1-2; library grid last-played order | proposed |
| A10 | surfaces | surface → surface calls through injection replaced per ADR-0044 (sections re-renders from the `achievements` part it already `reads`; captures → sections content flag; playbar ↔ game-info decided by the ADR) | F05 | A9 | sections appear/disappear with content (Routine 1), PlayBar ⓘ | proposed |
| A11 | surfaces, app, settings | nothing reads `getLocalAchievements`/`getLocalSchema` except the surface itself; the panel and the public API read `record.achievements` | F19 | A8 | Library Audit panel achievement counts unchanged | proposed |
| A12 | surfaces | **bug**: guardrail 8 in `surfaces/achievements/store.ts:311`; check K19's `getAchievementsAction` (it relies on "Steam-set details") before and after | F02 | — (first bug item; may run right after A2) | Game Info view of AM2R and WUCHANG opens without a `TypeError`; `probes/exception_stack.mjs 4263274102` and `3135033888` clean; Achievements tab still shows | proposed |
| A13 | settings, app, kernel | the `steam-cartridges:rule-updated` window event becomes a kernel event (`settings.changed` or a new `rules.updated`); the fake-achievement test hook stays documented | F20 | A8 | editing a rule refreshes the audit counts | proposed |
| A14 | backend | `metadata_service` stops requiring `web_rpc` (`get_shortcut_info` moves to `shortcuts.lua` or `registry.lua`); `achievements_store` loses its fetcher to a source module; `shortcut_icon.download` and `web_sgdb.download_image` removed if A1 makes base64 mandatory; Q3's layout ADR | F22-F25 | A1 | Lua suites; `EnsureFresh` metadata and achievements for the three test shortcuts | proposed |
| A15 | backend, ports, app, docs | dead code: `getGameRecord` + `GetGameRecord` (unless Q2 revives it), `GetArtworkForGame`, `SteamStoreGetAppDetails` (+ its Lua test lines), `removeLegacySyncHistory`, `setEnricher` if dead; rpc.md re-classified; `transport.ts` comment | F21, F27, F31 | Q6 order vs F1 | none beyond the baseline (the RPC-registration test proves nothing calls them) | proposed |
| A16 | docs | README § 4.1 table to the decided rules (settings row per Q4, safety row, the surface-injection rule, the `#listener` rule), surfaces.md, sensors.md, kernel.md updated; ADR-0044 accepted | F04, F26, R06, R20, R21 | all code items | — | proposed |
| A17 | tests | **the ratchet extension** (§ 7.3) | all | every other item | — | proposed |

### 7.3 A17: the capability ratchet (the prevention)

`tests/architecture.test.ts` gains one test, *"architecture: no layer does another layer's job (capability ratchet)"*, built like the
import ratchet so it is familiar:

- **Rules as data** in the test file, one entry per § 1 row: `{ id: "L1", area: /^(?!ports$)/, forbid: /\bfetch\(|XMLHttpRequest|FileReader|wsrv\.nl|callServerMethod/, why: "network I/O only in ports/" }`,
  and so on for L2-L7, L9, L10, L13-L15 (the scan headers of [scan.sh](steam-cartridges-architecture-audit/scan.sh) are the source; same regexes).
  The area comes from the existing `areaOf()`.
- **Comments are stripped** before matching (`/* … */` and `// …` to end of line), so `artwork.ts:24`'s comment is not a hit.
- **Frozen offenders** in `tests/architecture-capabilities-allowlist.json`: entries `"<rule id> <repo-relative file>"` (file level, not line level,
  so an unrelated edit does not churn it). Like the import allowlist it **only shrinks**: a listed entry that no longer matches fails the test
  ("delete it"). Regenerate only with `ARCH_WRITE_CAPABILITIES=1 npm run test:ts`, and only an M10 step or a later migration step may do that.
- **Injected deps** (L8): the test reads each `create*Surface({ … })` block in `index.tsx` and fails if an injected function's body names
  `backend.` or another surface's export. The allowed extra deps are listed per surface in the test (after M10: the pure reads ADR-0044 allows).
- **Touches** (L11): a Steam member declared by two surfaces must be on an explicit `SANCTIONED_LISTENERS` list (today: `collectionStore.OnAppOverviewChange`, ADR-0042).
- **Dead RPCs** (X1/X2): every name registered in `backend/main.lua` is either named in `ports/backend.ts` or listed in
  `tests/architecture-unwired-rpcs.json` with the plan that wires it (`{ "GetGameMedia": "features plan F2" }`); every `ports/backend.ts` method has a
  caller. (The debug RPC `GetDiagnostics` is listed with "debug: called from the console and tests/live/probes/http_calls.mjs".)
- **Backend rules** (B1, B3) read `backend/*.lua` the same way the RPC-registration test already does.
- guardrails 14 and 15 apply: the new test never weakens an existing one, and the allowlists are seeded with exactly what the batch could not fix
  (each entry with a TASK.md "later" line).

The dry-run of the M10 plan must show the test failing on `08b2960` for F01 (artwork `fetch`), then passing after A1 with the entry removed.
That is its proof.

### 7.4 Revert protocol for the batch

1. Before A1: `git tag m10-base` on the commit the M10 plan's preconditions name; push the tag (`git push origin m10-base`).
2. Each item's section in the M10 plan has **Reverted by** (`git revert <its commit>`) and **Must revert first** (the items that depend on
   it, from the "Depends on" column, in reverse order). A revert is itself a commit (`Revert "m10(A<n>): …"`), never a reset of pushed history.
3. **No persisted format changes** in M10 (migration plan § 8.2 do-not-touch 1: `library_metadata.json`, `steam_store.json`, `achievements.json`,
   `freshness.json`, `known_shortcuts.json`, settings keys and defaults). An item that needs one is taken out of the batch into its own plan with a
   `migrate.lua` step, a backup, and the reverse path written down.
4. No `FEATURE_IDS` entry, settings key or public `index.tsx` export is removed or renamed (Q8 may list exceptions).
5. **Live rollback** of a deployed batch: `git worktree add "$SCRATCH/rb" m10-base --detach`, link `node_modules` as a junction, run `dev.ps1`
   from the worktree, and **delete the junction before `git worktree remove`** (it otherwise deletes the real `node_modules`; migration plan
   § 7.0.1 step 3). The released `steam-cartridges` plugin is never touched (`dev.ps1` deploys `-dev`).
6. A reverted item re-opens its findings in the findings doc (Status "reverted <date>, <why>") and in TASK.md.

---

## 8. Do-not-touch (Part 1)

- Everything under `steam-cartridges/` (`frontend/`, `backend/`, `tests/`, including `tests/test_backend.lua`'s fixture and every allowlist JSON).
- [scan.sh](steam-cartridges-architecture-audit/scan.sh) and [scan-expected.txt](steam-cartridges-architecture-audit/scan-expected.txt) (they are the dry-run record),
  and `.gitattributes` (it keeps them LF).
- Other plans (`steam-cartridges-artwork-fetch-plan.md`, the F1 plan and its patches, the features plan, the migration plan), ADRs, layer docs:
  Part 1 records findings about them; the M10 plan changes them.
- Allowed writes: the new findings doc, this plan's **Status** line and § 7.2, TASK.md, CHANGELOG.md.

## 9. Banned actions (Part 1)

No product-code edit; no deploy or Steam restart (`dev.ps1`, `start-steam-dev.ps1`); no SharedJSContext reload; no CDP connection and nothing under
`tests/live/` (not even read-only probes: Part 1 is static); no probe or throwaway plugins; no edits to Millennium's `config.json` or the plugin's
config; no changes to the user's library, collections or shortcuts; no `npm install` / upgrade (ignore the `@steambrew/ttc` nag); no
`npm run build` (it is not needed and writes build output); no fixture update; no `git push --force`; no `--no-verify`; no `git stash`; no
subagents writing to the repo. Do not fix anything you find, however small: write it down.

## 10. Failure rule

Run a failing command at most twice. On the second failure, stop: append the command, its output (trimmed to 30 lines) and the step
number (S0-S9) to [TASK.md](../../TASK.md) § Active Failures & Blockers, then exit. Do not retry, edit around the failure or skip ahead.
A scan diff (S2) is **not** a failure: it is data. A precondition mismatch (S0) **is** one.

## 11. Commit instructions (S9)

From `REPO`:

```bash
git add docs/plans/steam-cartridges-architecture-audit-findings.md docs/plans/steam-cartridges-architecture-audit-plan.md TASK.md CHANGELOG.md
git status --short   # must list exactly those four paths (the findings doc as A, the others as M)
git commit -m "docs(plan): steam-cartridges migration audit Part 1 findings and decisions" -m "Co-Authored-By: <the attribution line your session gives>"
git push origin main
```

This repo is exempt from AGENTS.md Routine 6 (nothing here goes to `SteamClientHomebrew/Millennium`).

### Guardrail checklist (Part 1)

The audit changes no code, so it cannot violate a guardrail; tick each with its proof:
- [ ] **15 (never weaken a check):** `git diff HEAD~1 --stat -- steam-cartridges` prints nothing after the commit.
- [ ] **9 (CDP suite):** not run on purpose (§ 9); the M10 plan runs it.
- [ ] **14 (a new gate never removes behaviour):** not applicable to Part 1; § 7.3 applies it to A17.

---

## 12. Dry-run record (2026-09-30, `08b2960`)

Done by the architect in the main tree, read-only:
- S0 P3-P5: observed exactly as written in § 5 S0 (tsc clean; `ℹ pass 160`; the nine Lua suites with the three library-fixture FAILs).
- S1: 48 edges, none outside `LAYER_RULES`; allowlist `[]`.
- S2: `scan.sh` run twice; the second run is identical to `scan-expected.txt` (262 lines, 30 scans), so the output is stable. On the dry-run
  machine three `.ts` files are CRLF in the working tree (index LF), and `git grep` reads the working tree: the script strips `\r` from its
  output, and `.gitattributes` pins the audit folder to LF, so the `diff` does not depend on the checkout.
- § 3: every row's evidence was run; line numbers are those printed. Not yet done (left to S3/S4 on purpose): F03's and F31's read, F15's
  classification, `setEnricher`'s purpose, the full S4 read-through, "Introduced by" (both S3 commands were run for F02 and for F18's
  `RETRY_MS` in `app/artwork.ts`, which was introduced by `32e0bfb … (M5c)`: a migration step created it, so it is a decision gap, R16).
- § 4: R04 checked (`runner.render` has one caller); R01's edge count and allowlist checked; the others cite § 3 findings.
- Not dry-run: S7 (needs the user), S8-S9 (depend on S7). The M10 plan (Part 2) will have its own dry-run.
