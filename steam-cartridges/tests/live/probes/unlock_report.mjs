// Reads a log of unlock_watcher.mjs and prints, around each MARK (the moment the user saw the toast), what every sensor saw.
//   node tests/live/probes/unlock_report.mjs [log.jsonl] [--before 10] [--after 10] [--all]
// With no file it takes the newest scratch/unlock-watch-*.jsonl. Quiet noise (the watcher's own helpers) is left out unless --all.
// Per mark: the events from `before` seconds before it to `after` seconds after, oldest first, with their distance to the mark
// ("-1.8s" = 1.8 s before you pressed Enter), then the first deterministic suspect per sensor.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const num = (n, d) => Number(args[args.indexOf(n) + 1] ?? d) || d;
const BEFORE = num("--before", 10), AFTER = num("--after", 10);
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "scratch");
const file = args.find((a) => a.endsWith(".jsonl")) ?? join(dir, readdirSync(dir).filter((f) => f.startsWith("unlock-watch-") && f.endsWith(".jsonl")).sort().at(-1));
const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((r) => ({ ...r, ms: Date.parse(r.ts) }));
const marks = rows.filter((r) => r.sensor === "user" && r.kind === "MARK");
console.log(`${file}\n${rows.length} lines, ${marks.length} mark(s)\n`);
const brief = (r) => {
    const { ts, t, sensor, kind, hot, quiet, ms, ...d } = r;
    return Object.entries(d).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ").slice(0, 500);
};
for (const m of marks) {
    console.log(`=== MARK ${m.ts.slice(11, 23)} "${m.note}" ===`);
    const near = rows.filter((r) => r.ms >= m.ms - BEFORE * 1000 && r.ms <= m.ms + AFTER * 1000 && r.sensor !== "user" && (args.includes("--all") || !r.quiet) && r.kind !== "baseline");
    for (const r of near) console.log(`${(((r.ms - m.ms) / 1000).toFixed(1) + "s").padStart(7)} ${r.sensor.padEnd(7)} ${r.kind.padEnd(9)} ${r.hot ? "★ " : "  "}${brief(r)}`);
    console.log("\n  first event per sensor before the mark (the earliest candidate for a trigger):");
    for (const sensor of [...new Set(near.map((r) => r.sensor))]) {
        const first = near.filter((r) => r.sensor === sensor && r.ms <= m.ms)[0] ?? near.find((r) => r.sensor === sensor);
        console.log(`   ${sensor.padEnd(7)} ${(((first.ms - m.ms) / 1000).toFixed(1) + "s").padStart(7)} ${first.kind}`);
    }
    console.log();
}
