// Read-only: a shortcut's achievement totals as Steam's own stores hold them, plus the plugin's log lines
// about achievements and any console error mentioning unlocks, captured while the page is opened first.
//   node scratch/arch-m0/ach_state.mjs <appid> [settleMs=12000]
import { pick, session } from "./cdp.mjs";
const APPID = Number(process.argv[2]);
const SETTLE = Number(process.argv[3] || 12000);
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
const lines = [], errors = [];
s.on((m) => {
  if (m.method === "Runtime.consoleAPICalled") {
    const text = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").replace(/%c|background:[^;]*;|color:[^;]*;/g, "").trim();
    if (/newUnlocks|\.map is not a function/i.test(text)) errors.push(text.slice(0, 200));
    if (text.includes("Steam Cartridges") && /Achievements|achievements for shortcut|unlock/i.test(text) && text.includes(String(APPID))) lines.push(text.slice(0, 160));
  }
  if (m.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(m.params.exceptionDetails?.exception?.description ?? "").slice(0, 200));
});
await s.send("Runtime.enable");
await s.send("Runtime.evaluate", { expression: `SteamUIStore.WindowStore.SteamUIWindows.find(w=>w.Navigator?.AppProperties)?.Navigator.App(${APPID}),1` });
await new Promise((r) => setTimeout(r, SETTLE));
const r = await s.send("Runtime.evaluate", { returnByValue: true, awaitPromise: true, expression: `(async () => { const a = appDetailsStore.GetAppData(${APPID})?.achievements; return JSON.stringify({ nTotal: a?.nTotal ?? null, nAchieved: a?.nAchieved ?? null }); })()` });
console.log(JSON.stringify({ appid: APPID, stores: r.result?.result?.value, logs: [...new Set(lines)].slice(-6), errors }, null, 1));
process.exit(0);
