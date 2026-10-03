// npm run test:live: the § 0.5 live baseline against the running Steam client (127.0.0.1:8080, dev plugin deployed).
// A check may SKIP when the client is in a mode it cannot test (parity in Big Picture).
// Each check must exit 0 and print no FAIL line; check_all_tabs is retried once (its card count is timing-sensitive).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Hold the Steam lock for the whole run, so no other agent restarts or drives Steam
// meanwhile (AGENTS.md, "Sharing the live Steam client"). Re-entrant through
// STEAM_LOCK_OWNER; released on exit only if taken here. Absent in a public repo.
const lockLib = join(here, "..", "..", "..", "steam-lock.mjs");
const steamLock = existsSync(lockLib) ? await import(pathToFileURL(lockLib).href) : null;
const lockOwner = process.env.STEAM_LOCK_OWNER ?? "test-live-steam-cartridges-" + process.pid;
const lockState = steamLock ? await steamLock.acquire({ owner: lockOwner, purpose: "steam-cartridges npm run test:live", wait: 900, ttl: 3600 }) : "none";
if (lockState === "timeout") {
    console.log("FAIL  steam-lock: Steam is still in use by another agent after 15 min (node steam-lock.mjs status)");
    process.exit(1);
}
process.on("exit", () => lockState === "acquired" && steamLock.release({ owner: lockOwner }));
process.on("SIGINT", () => process.exit(130));
const checks = [
    // first: is Steam's UI up and every enabled plugin loaded? Workspace-only script, skipped in a public repo.
    { name: "boot health (UI rendered, plugins loaded)", file: "../../../steam-health.mjs", args: [], must: /^PASS/m, skipWhen: /Cannot find module/ },
    // first: something in the later checks makes Steam drop back into Big Picture, which has no desktop window
    { name: "parity (needs the desktop window, not Big Picture)", file: "check_parity.mjs", args: [], must: /./, skipWhen: /No CDP target: desktop Steam window/ },
    { name: "K4: Mark as Private disabled (desktop)", file: "probes/manage_menu.mjs", args: [], must: /^PASS K4/m },
    { name: "K6: overview repair via trigger", file: "probes/overview_repair.mjs", args: [], must: /^PASS K6/m },
    { name: "render loop", file: "count_cycle.mjs", args: ["4263274102"], must: /^PASS render loop:/m },
    { name: "Properties (WUCHANG)", file: "test_props.mjs", args: ["3135033888", "--page"], must: /page=true: OK/ },
    { name: "Properties (Jotunnslayer)", file: "test_props.mjs", args: ["4202674849", "--page"], must: /page=true: OK/ },
    { name: "navigation cycle", file: "test_nav_cycle.js", args: [], must: /^PASS/m },
    { name: "tabs", file: "check_all_tabs.js", args: [], must: /^PASS/m, retry: true },
    { name: "settings panel renders", file: "check_settings_panel.mjs", args: [], must: /^PASS Manual Edit/m },
    { name: "F1: Game Data editor (save, revert, search)", file: "probes/game_editor.mjs", args: [], must: /^PASS F1 revert/m },
    { name: "F2: community media in Steam's Community section (AM2R)", file: "probes/community_media.mjs", args: ["4263274102"], must: /^PASS F2 cards/m },
    { name: "audit: no missing metadata", file: "audit_missing_metadata.mjs", args: [], must: /./ },
];

function run(c) {
    const r = spawnSync(process.execPath, [join(here, c.file), ...c.args], { encoding: "utf8", timeout: 180_000 });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    const skipped = c.skipWhen?.test(out) === true;
    return { ok: skipped || (r.status === 0 && c.must.test(out) && !/^FAIL/m.test(out)), skipped, out };
}

let bad = 0;
for (const c of checks) {
    let r = run(c);
    if (!r.ok && c.retry) r = run(c);
    console.log(`${r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL"}  ${c.name}`);
    if (!r.ok) {
        bad++;
        console.log(r.out.split("\n").slice(-15).join("\n"));
    }
}
process.exit(bad ? 1 : 0);
