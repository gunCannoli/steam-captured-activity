// M5c live check: open a shortcut's page and report which grid art files appear or change, and what the
// backend recorded. Default target: Firestriker 3381982601 (only its hero slot is empty).
//   node tests/live/probes/sgdb_live.mjs [appid=3381982601] [settleMs=20000]
import fs from "node:fs";
import { pick, session } from "../cdp.mjs";
const APPID = Number(process.argv[2] || 3381982601);
const SETTLE = Number(process.argv[3] || 20000);
const GRID = "C:/game/steam/userdata/83513586/config/grid/";
const STORE = "C:/game/steam/millennium/config/steam-cartridges/steam_store.json";
const snap = () => {
  const out = {};
  for (const f of fs.readdirSync(GRID)) if (f.startsWith(String(APPID)) && !/^\d+\d/.test(f.slice(String(APPID).length, String(APPID).length + 1))) {
    const st = fs.statSync(GRID + f);
    out[f] = `${st.size}b@${st.mtimeMs | 0}`;
  }
  return out;
};
const state = () => {
  const s = JSON.parse(fs.readFileSync(STORE, "utf8"));
  const negatives = Object.keys(s.negative).filter((k) => k.startsWith("sgdb:")).length;
  return { applied: s.applied_artwork[String(APPID)] ?? null, sgdbNegatives: negatives };
};
const before = snap();
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
const lines = [];
s.on((m) => {
  if (m.method !== "Runtime.consoleAPICalled") return;
  const text = m.params.args.map((a) => a.value ?? "").join(" ").replace(/%c|background:[^;]*;|color:[^;]*;/g, "");
  if (text.includes("Steam Cartridges") && /Artwork|art slot|custom (portrait|hero|logo|wide)|SteamGridDB/i.test(text)) lines.push(text.trim().slice(0, 160));
});
await s.send("Runtime.enable");
const nav = `SteamUIStore.WindowStore.SteamUIWindows.find(w=>w.Navigator?.AppProperties)?.Navigator`;
await s.send("Runtime.evaluate", { expression: `${nav}.App(${APPID}),1` });
await new Promise((r) => setTimeout(r, SETTLE));
const after = snap();
const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]);
console.log(JSON.stringify({ appid: APPID, added: changed.filter((k) => !(k in before)), modified: changed.filter((k) => k in before && k in after), removed: changed.filter((k) => !(k in after)), state: state(), log: lines }, null, 1));
process.exit(0);
