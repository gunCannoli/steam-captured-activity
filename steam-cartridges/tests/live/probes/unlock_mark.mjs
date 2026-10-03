// Marks "I see the toast NOW" in the newest unlock_watcher log, from another terminal (when Enter in the watcher's console is out of reach, e.g. over RDP).
//   node tests/live/probes/unlock_mark.mjs ["note"]
import { appendFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "scratch");
const file = join(dir, readdirSync(dir).filter((f) => f.startsWith("unlock-watch-") && f.endsWith(".jsonl")).sort().at(-1));
const ts = new Date().toISOString();
appendFileSync(file, JSON.stringify({ ts, t: "-", sensor: "user", kind: "MARK", hot: true, note: process.argv[2] || "(toast seen now)", how: "mark script" }) + "\n");
console.log(`marked ${ts.slice(11, 23)} in ${file}`);
