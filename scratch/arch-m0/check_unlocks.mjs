// Live K1 check: call the plugin's public checkObserverUnlocks and report what came back (must be a number, no throw).
//   node scratch/arch-m0/check_unlocks.mjs <shortcutAppid> <nativeAppid> [title]
import { pick, session } from "./cdp.mjs";
const [sc, native, title] = [Number(process.argv[2]), Number(process.argv[3] || 0), process.argv[4] || ""];
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
const r = await s.send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `(async () => { const P = (PLUGIN_LIST['steam-cartridges-dev'] ?? PLUGIN_LIST['steam-cartridges']); try { const n = await P.checkObserverUnlocks(${sc}, ${native}, ${JSON.stringify(title)}); return JSON.stringify({ type: typeof n, value: n }); } catch (e) { return JSON.stringify({ threw: String(e) }); } })()` });
console.log(r.result?.result?.value ?? JSON.stringify(r));
process.exit(0);
