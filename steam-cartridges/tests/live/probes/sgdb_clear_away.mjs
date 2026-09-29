// M5c live check: Clear removes only the art we wrote. Leaves Big Picture and opens a different game
// first, so no view of the target re-fills the slot while we look.
//   node tests/live/probes/sgdb_clear_away.mjs [appid=3381982601] [awayAppid=2315502503]
import fs from "node:fs";
import { pick, session } from "../cdp.mjs";
const APPID = Number(process.argv[2] || 3381982601);
const AWAY = Number(process.argv[3] || 2315502503);
const GRID = "C:/game/steam/userdata/83513586/config/grid/";
const snap = () => Object.fromEntries(fs.readdirSync(GRID).filter((f) => new RegExp("^" + APPID + "(?![0-9])").test(f)).sort().map((f) => [f, fs.statSync(GRID + f).mtimeMs | 0]));
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
const ev = (expression, awaitPromise = false) => s.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
await ev(`window.SteamClient?.UI?.ExitBigPictureMode?.(), 1`);
await new Promise((x) => setTimeout(x, 4000));
const nav = `SteamUIStore.WindowStore.SteamUIWindows.find(w=>w.Navigator?.AppProperties)?.Navigator`;
await ev(`${nav}?.App(${AWAY}), 1`);
await new Promise((x) => setTimeout(x, 6000));
const before = snap();
const r = await ev(`(async () => { const P = (PLUGIN_LIST['steam-cartridges-dev'] ?? PLUGIN_LIST['steam-cartridges']); const res = await P.clearSteamStore(${APPID}, false); return JSON.stringify({ slots: res.slots }); })()`, true);
await new Promise((x) => setTimeout(x, 6000));
const after = snap();
const st = JSON.parse(fs.readFileSync("C:/game/steam/millennium/config/steam-cartridges/steam_store.json", "utf8"));
console.log(JSON.stringify({ clearReturned: r.result?.result?.value, removed: Object.keys(before).filter((f) => !(f in after)), untouched: Object.keys(after).filter((f) => after[f] === before[f]), applied: st.applied_artwork[String(APPID)] ?? null }, null, 1));
process.exit(0);
