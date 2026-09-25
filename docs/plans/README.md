# Plans

**This folder's job:** one plan per feature or bugfix, written by the architect
and executed by the implementer. History goes to [CHANGELOG.md](../../CHANGELOG.md).
Rules for plugin code live in [plugins.md](../plugins.md).

## Plan writing standard for the weak implementer

Assume the implementer cannot infer intent, loops on failures, and improvises
when stuck. Every plan must be fully mechanical and contain:

1. **Root cause with evidence.** Live captures, file:line, commit. Say what was
   ruled out.
2. **Preconditions.** A command plus the exact expected output that must hold
   before step 1 (clean tree, baseline test count, `tsc` clean).
3. **Ordered steps.** For each step: exact file path, exact symbol, the literal
   **before** block (copied from the file, so a mismatch shows the plan is stale)
   and the literal **after** block. No "update accordingly" or "similar to".
4. **A command after every step** with its exact expected output (e.g.
   `npm run check` prints nothing after the npm banner and exits 0;
   `npm run test:ts` ends `ℹ pass 19` / `ℹ fail 0`).
5. **Do-not-touch list.** Files and symbols that must not change.
6. **Banned actions.** At minimum: no deploy or Steam restart (`dev.ps1`), no
   SharedJSContext reload, no probe or throwaway plugins, no edits to
   Millennium's `config.json` or plugin config, no changes to the user's
   library, collections or shortcuts, no `npm install`/upgrade (the build prints
   an `@steambrew/ttc` update nag; ignore it), no `git push --force`, no
   `--no-verify`.
11. **Dry-run it.** Before handing over, apply the before/after blocks to a
    scratch copy and confirm every expected output in the plan. Say so in the plan.
7. **Failure rule.** Run a failing command at most twice. On the second failure,
   stop. Append the command, its output (trimmed to 30 lines) and the step
   number to `TASK.md` § Active Failures & Blockers, then exit. Do not retry,
   edit around the failure or skip ahead.
8. **Guardrail checklist.** The numbered [plugins.md](../plugins.md) guardrails
   the change touches. The implementer re-reads each one and ticks it as "not
   violated", with one line of proof.
9. **Commit instructions.** Exact `git add` paths (never `-A` when unrelated
   files may exist), the message and the attribution line.
10. **Live verification.** What the user or verifier runs after deploy, and the
    exact PASS lines expected. The implementer does not run it unless the plan
    says so.
