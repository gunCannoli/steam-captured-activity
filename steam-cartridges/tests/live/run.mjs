// npm run test:live: the § 0.5 live baseline against the running Steam client (127.0.0.1:8080, dev plugin deployed).
// A check may SKIP when the client is in a mode it cannot test (parity in Big Picture).
// Each check must exit 0 and print no FAIL line; check_all_tabs is retried once (its card count is timing-sensitive).
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const checks = [
    // first: something in the later checks makes Steam drop back into Big Picture, which has no desktop window
    { name: "parity (needs the desktop window, not Big Picture)", file: "check_parity.mjs", args: [], must: /./, skipWhen: /No CDP target: desktop Steam window/ },
    { name: "render loop", file: "count_cycle.mjs", args: ["4263274102"], must: /^PASS render loop:/m },
    { name: "Properties (WUCHANG)", file: "test_props.mjs", args: ["3135033888", "--page"], must: /page=true: OK/ },
    { name: "Properties (Jotunnslayer)", file: "test_props.mjs", args: ["2315502503", "--page"], must: /page=true: OK/ },
    { name: "navigation cycle", file: "test_nav_cycle.js", args: [], must: /^PASS/m },
    { name: "tabs", file: "check_all_tabs.js", args: [], must: /^PASS/m, retry: true },
    { name: "settings panel renders", file: "check_settings_panel.mjs", args: [], must: /^PASS Troubleshooting/m },
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
