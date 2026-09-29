// Read-only: open a shortcut page and print the full stack of the first unhandled exception.
//   node tests/live/probes/exception_stack.mjs <appid>
import { pick, session } from "../cdp.mjs";
const APPID = Number(process.argv[2]);
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
const out = [];
s.on((m) => { if (m.method === "Runtime.exceptionThrown") { const e = m.params.exceptionDetails; out.push(e.exception?.description ?? e.text); } });
await s.send("Runtime.enable");
await s.send("Runtime.evaluate", { expression: `SteamUIStore.WindowStore.SteamUIWindows.find(w=>w.Navigator?.AppProperties)?.Navigator.App(${APPID}),1` });
await new Promise((r) => setTimeout(r, 8000));
console.log(out.find((x) => /RequestAchievements/.test(x ?? "")) ?? "(none)");
process.exit(0);
