// Open a shortcut's page in the desktop window and wait, so page-load pipelines have run.
//   node tests/live/probes/open_app.mjs <appid> [settleMs=12000]
import { pick, session } from "../cdp.mjs";
const APPID = Number(process.argv[2]);
const SETTLE = Number(process.argv[3] || 12000);
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
await s.send("Runtime.evaluate", { expression: `SteamUIStore.WindowStore.SteamUIWindows.find(w=>w.Navigator?.AppProperties)?.Navigator.App(${APPID}),1` });
await new Promise((r) => setTimeout(r, SETTLE));
console.log("opened", APPID);
process.exit(0);
