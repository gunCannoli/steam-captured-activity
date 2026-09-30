# TASK — current status & what's next

Lean tracker: **what we're doing and what's next, nothing else.** Shipped
work (with verification logs and rationale) lives in
[CHANGELOG.md](CHANGELOG.md) (workspace) and each plugin's own
`CHANGELOG.md`. Detailed root cause, ordered steps and execution records
live in per-feature plans under [docs/plans/](docs/plans/) — link to them,
don't duplicate them here. ADRs are in [docs/decisions.md](docs/decisions.md).

**Goal:** a non-Steam game's app detail page looks like a native one, on both
desktop and Big Picture, by restoring Steam's own sections and feeding Steam's
own stores — not by rebuilding the page ([ADR-0022](docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).
`enhanced-achievements` and `enhanced-notifications` are separate plugins that
theme Steam's toasts and sounds.

---

## Now

**F1 Game Data editor: code committed on top of M10 (2026-09-30), waiting for live verification.** Deploy with `dev.ps1`, then
follow [the F1 plan § 7](docs/plans/steam-cartridges-f1-game-data-editor-plan.md) (`check_settings_panel.mjs` 9 titles,
`probes/game_editor.mjs`, `npm run test:live`, the by-hand check on desktop and Big Picture). Then mark F1 done in the
[features plan](docs/plans/steam-cartridges-features-plan.md) and open F2 (Media in the Community tab).

**Owed by a human:** the five visual hand checks listed in [verification.md](docs/steam-cartridges/verification.md) (never run after M10).
The shortcut library icon's optional last check (choose an icon by hand, confirm it is kept) is also yours.

**Done and live-verified, history in [CHANGELOG.md](CHANGELOG.md):** the `steam-cartridges` migration M0-M10 (ports and adapters,
[ADR-0039](docs/decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam) to
[ADR-0044](docs/decisions.md#adr-0044-steam-cartridges-layers-stay-dumb-and-a-test-checks-what-each-layer-does)); the
`enhanced-achievements` migration E0a-E3 ([ADR-0043](docs/decisions.md#adr-0043-enhanced-achievements-has-one-owner-per-steam-target-and-a-safety-net)).
How to verify and roll back: [verification.md](docs/steam-cartridges/verification.md).

## Considerations (decided later, not scheduled)

- **Surface `deps` singletons (F30).** Each `surfaces/*/deps.ts` is a module-level object that `create*Surface` overwrites. Rewriting the
  six surfaces as real factories would touch every Steam hook (the highest-risk code) for a benefit that has not occurred. Instead add one
  capability-ratchet rule in `tests/architecture.test.ts`: `index.tsx` calls each `create*Surface` at most once, and nothing outside a
  surface's folder imports its `deps`. Revisit the factory rewrite only if a surface ever needs a second instance.
- **K20:** load the controller inference at start-up (`void controller.load()` in `init()`), live-check AM2R's badge.

## Next

- **Strip AI co-author trailers from history — run only when every other agent is idle.** 119 of the 276 commits on `main` (as of
  2026-09-30, `223873a`..`aef1dd2`) end with `Co-Authored-By: Claude … <noreply@anthropic.com>` (Sonnet 5: 50, Sonnet 5.5: 44, Opus 5.5: 25);
  all are already on `origin/main`. Policy: [AGENTS.md Routine 6](AGENTS.md#routine-6-commit-guardrail--never-add-ai-agents-as-contributors).
  Steps:
  1. Confirm no agent has uncommitted work or an open session; `git pull`, `git status` clean, note `git rev-list --count main`.
  2. Recount: `git rev-list --count -i -E --grep='co-authored-by:.*(claude|anthropic)' main` (it grows while agents still use the old default).
  3. Backup: `git branch backup-trailers main`.
  4. `git filter-branch -f --msg-filter '<script deleting the Co-Authored-By Claude/anthropic line and any blank line it leaves at the end>' -- main`.
  5. Verify: `git diff backup-trailers main --stat` is empty, the count in step 2 is 0, commit count is unchanged, `git log --format=%B | grep -ci 'generated with'` is 0.
  6. `git push --force-with-lease origin main`, then delete `backup-trailers`, `backup-e0a`, `backup-docs-split` and `refs/original/*` (they keep the old trailers reachable locally).
  7. Tell the user every other clone and agent must `git fetch && git reset --hard origin/main` (their unpushed work must be rebased first). Old SHAs stay resolvable on GitHub until a support ticket purges them.
  Skip it only if the history is never made public or the plugin repos are started fresh rather than extracted.
- **Phase 9 — provider contract** ([ADR-0013](docs/decisions.md#adr-0013-providers-return-data-the-core-renders-it),
  [ADR-0014](docs/decisions.md#adr-0014-providers-are-isolated-and-fail-silently)), after the migration:
  a provider becomes one more source adapter behind the migration's source contract.
- **Provider Plugin Extraction**: Extract `retroachievements` and `screenscraper`/`igdb`
  into standalone provider plugins communicating via the Phase 9 IPC contract.

## Later

- Optional SteamGridDB artwork filter rules (`g{Author:maxKB}` per artwork type, off by
  default), from the removed `docs/steam-cartridges.md` § 6
  (`git show 0d599cf:docs/steam-cartridges.md`). After the migration, as a source adapter.

## Waiting on the user

- Alpha testing checklist (U1–U9, real hardware/real unlocks only) —
  [phase7-and-alpha-plan.md § User test checklist](docs/plans/phase7-and-alpha-plan.md#user-test-checklist-only-the-user-can-verify).

## Blocked upstream

- **Millennium Configuration API bug** [#903](https://github.com/SteamClientHomebrew/Millennium/issues/903)
  (fix proposed in [PR #904](https://github.com/SteamClientHomebrew/Millennium/pull/904)).
  Re-test and drop the workaround in both plugins' `settings.ts` once fixed.

## Active failures & blockers

None.

---

## Before writing any code

Building a plugin or a feature? Follow the playbook in
[docs/plugins.md § Playbook](docs/plugins.md#playbook-creating-a-plugin-or-a-feature).
Every other doc, by situation: [docs/README.md](docs/README.md).
