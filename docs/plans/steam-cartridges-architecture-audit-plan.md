# Plan: audit the steam-cartridges migration for layer overlaps (skeleton)

**Status:** Skeleton (2026-09-29); Part 2 (§ 4b) absorbs the artwork fetch plan as item A1. Not executable yet: § 3 to § 8 are outlines to be filled in (commands, expected output, dry-run) before handing to an implementer.
**Kind:** Read-only audit that ends in findings and child plans. It changes no product code.
**Why:** the [migration plan](steam-cartridges-architecture-migration-plan.md) split the plugin into layers and only the *import ratchet*
(`tests/architecture.test.ts`) enforces it. The ratchet checks **who imports whom**, not **what each layer does**. That is how
`surfaces/artwork/artwork.ts` kept its own `fetchImageAsBase64` (network I/O in a surface, a copy of `ports/image.ts`, a backend-download
fallback that writes a 4-byte image) after M3 "was done" ([artwork fetch plan](steam-cartridges-artwork-fetch-plan.md)).
**Goal:** find every other place where a layer does another layer's job, and make the rule mechanical so it cannot come back.

## 1. The rule being audited (one job per layer)

From [README § May import / must never import](../steam-cartridges/README.md) and [surfaces.md](../steam-cartridges/surfaces.md):

| Layer | Its one job | Must not do (the audit's search targets) |
| --- | --- | --- |
| `kernel/` | types, events, record store, pure containers | import anything of ours, touch Steam, `fetch`, RPC |
| `domain/` | pure policy | `window`, `SteamClient`, `fetch`, RPC, timers, logging side effects |
| `sensors/` | observe Steam, publish events | write to Steam (`SteamClient.*.Set*`, `Clear*`, `Save*`), call RPC, `fetch` |
| `app/` | decide, orchestrate, put results in the record | touch Steam (`window.SteamClient`, stores), render, write files |
| `ports/` | the only door to the outside (RPC, HTTP) | touch Steam, decide policy |
| `surfaces/<name>/` | the only code that writes to Steam, executing the plan in the record | network I/O (`fetch`, `XMLHttpRequest`, `FileReader`, `callServerMethod`), decide policy, read another surface |
| `settings/` | panels | write Steam surfaces, own business rules |
| `backend/` services | resolve/fetch/store, one owner per data | duplicate another service's source; write Steam's files |

## 2. Method: three kinds of check, cheapest first

1. **Forbidden-symbol scan per layer** (mechanical, minutes): a `git grep` table, one row per layer rule above, listing every hit outside its
   allowed layer. Seed patterns: `fetch(`, `FileReader`, `wsrv`, `callServerMethod`, `SteamClient\.` writes, `window\.` in `app/` and `domain/`,
   `setTimeout` in `domain/`, `logger` in `kernel/`.
2. **Duplicate-job scan** (mechanical): the same helper in two layers. Seed: function names and string constants that appear in more than one
   folder (`git grep -c` per identifier of every exported function), every host or URL literal in more than one file, every backend RPC with no
   frontend caller and every port method with no app caller (dead-code rule D13).
3. **Read-through of the risky pairs** (judgement, capped): each surface's `execute` against its plan type in `kernel/record.ts` (does the surface
   decide anything the plan did not tell it?), each `app/` file against `surfaces/` (does app write?), each backend service against `net.lua`
   (does it bypass the one HTTP entry point?).

## 3. Steps (outline, to be written mechanically)

1. **Baseline:** clean tree, `npm run check`, `npm run test:ts`, Lua suites, exact counts recorded (as the artwork fetch plan § 2).
2. **Run the scan table (§ 2.1)** and paste every hit into a findings table: `file:line | layer | rule broken | evidence | severity`.
3. **Run the duplicate scan (§ 2.2)**; add the hits to the same table.
4. **Read-through (§ 2.3)**, at most the 9 surfaces and the 9 `app/` files; each gets one row, "clean" or a finding.
5. **Classify** each finding: *bug* (wrong behaviour, like the 4-byte fallback), *overlap* (two owners), *debt* (right owner, wrong place), *false positive* (allowed, say why).
6. **Write child plans**, one per cluster, each to the [plan standard](README.md) (the artwork fetch plan is the model). Do not fix anything in this audit.

## 4. Deliverables

- `docs/plans/steam-cartridges-architecture-audit-findings.md`: the findings table, the classification, the child-plan list with order.
- Child plans for every *bug* and *overlap*; *debt* goes to a "Later" line in TASK.md.
- **The ratchet, extended** (the real prevention, its own child plan): `tests/architecture.test.ts` gains a second check, *forbidden identifiers per area*,
  fed by the § 1 table, with the currently accepted offenders in an allowlist that can only shrink (the same idea as `architecture-allowlist.json`).
  The artwork surface's `fetch` would have failed it on day one.

## 4b. Part 2: return to the migration, fix the gaps in one cohesive batch

The audit is Part 1 (find). Part 2 finishes what [the migration plan](steam-cartridges-architecture-migration-plan.md) set out to do: every gap the audit finds is a
**gap in that plan's execution**, so it is fixed as a step of the migration ("M10: close the gaps"), not as a stray feature plan. Decision (the user, 2026-09-29): one cohesive batch, not one plan per offender.

| Id | Gap (audit finding) | Detail plan | Status |
| --- | --- | --- | --- |
| A1 | `surfaces/artwork` fetches images itself; backend download fallback writes a 4-byte image | [steam-cartridges-artwork-fetch-plan.md](steam-cartridges-artwork-fetch-plan.md) (kept as the detail plan of A1: kernel image bin, `ports/image`, `app/artwork`, remove `SteamStoreDownloadImage`; the user's decisions are in its § 0) | found, planned (draft, not dry-run) |
| A2.. | (the audit fills these in) | | |

Batch rules (to be expanded):
1. Order: A-items sorted by layer, kernel and ports first, then app, then surfaces, then backend, then the ratchet extension (§ 4) **last**, seeded with whatever the batch could not fix.
2. One shared preconditions block and one shared live verification (`npm run test:live` plus the affected probes) for the whole batch, run once after the last item; each item keeps its own unit-test expectations.
3. Each item stays one commit (steps that leave `tsc` red, like A1 steps 3-5, are one commit); the batch is pushed after the live run passes.
4. Plans that touch the same files (F1 game data editor) are updated first, so nothing is applied on a stale before-block (A1 § 0 decision 2).
5. The migration plan gets a closing entry (its status board) and the CHANGELOG one bullet per item when the batch is live-verified.

## 5. Do-not-touch, banned actions, failure rule

Read-only: no edits under `frontend/`, `backend/`, `tests/` in this plan; no deploy, no Steam restart, no `tests/live/` run, no `npm install`. Failure rule as in
[the plan standard](README.md) (a failing command at most twice, then TASK.md § Active Failures & Blockers). *(To be expanded with the full banned list.)*

## 6. Guardrail checklist

To be filled from [plugins.md](../plugins.md): guardrails 14 and 15 (never weaken a check) apply to the ratchet extension; the audit itself violates none.

## 7. Open questions for the executor of the skeleton

- Is `settings/` allowed to import `domain/`? (README says `kernel`, `ports` only.) Decide, then encode.
- Which layers may log? (`kernel/` should not.)
- Backend: does a "one owner per data" table exist? If not, the audit writes it (`resolve_identity`, `metadata_service`, `art_service`, `ach_service`, `freshness`, `net`).

## 8. Execution estimate

Scan and duplicate steps are commands only (small). The read-through (step 4) is the token cost; cap it at the 9 surfaces and 9 `app/` files, and run the
scans first so the read-through only visits files with hits.
