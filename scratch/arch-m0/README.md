# scratch/arch-m0 — M0a render-loop investigation tools

Evidence and verification scripts for the Properties-dialog hang
([migration plan § 1.3 and M0a](../../docs/plans/steam-cartridges-architecture-migration-plan.md)).
All need Steam started with `-dev -cef-enable-debugging` (`start-steam-dev.ps1`) and Node 24
(built-in `WebSocket`, no npm packages).

| Script | Use |
| --- | --- |
| `cdp.mjs` | Shared CDP helper (targets, session, evalIn). |
| `probe.mjs "<expr>" [target]` | Evaluate one expression in SharedJSContext (or a titled target). |
| `test_props.mjs <appid> --page` | Open the game page, then Properties; prints `OK` or `HUNG after ~Ns`. |
| `count_cycle.mjs [appid]` | Counts plugin log lines with the page open, then with Properties open; prints `PASS render loop: ...` or `FAIL ...`. |
| `catch_hang.mjs <appid>` | Attaches the debugger **before** reproducing, then samples the hung thread's stacks. Leaves Steam hung: restart after. |
| `repro_properties.mjs [appid]` | First repro: records exceptions/console errors while opening Properties. |
| `m0a_blocks.py <plugin dir> check\|apply` | The M0a literal before/after blocks; `check` proves the plan is not stale. |

Step payloads (copied byte-for-byte by the executing agent, never retyped):

| Folder | Step | Contents |
| --- | --- | --- |
| `m0a_blocks.py` | M0a | 15 literal blocks (render-loop fix) |
| `m0b/` | M0b-1 | `m0b1_blocks.py` (18 blocks: settings key + `index.tsx` wiring), `safety/features.ts`, `safety/boot.ts`, `switches.ts`, `safety.test.ts` |
| `m0c/` | M0c | `architecture.test.ts` (import ratchet + RPC registration), `m0c_blocks.py` (2 blocks: `check_all_tabs.js` flake fix) |
| `m1/` | M1 | `kernel/{appid,events,record,surface}.ts`, `kernel.test.ts` |

Every block script matches the file's own line endings (CRLF or LF) and refuses to
apply when a "before" block is not found exactly once (`STALE`).
