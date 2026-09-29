// Debugging: the ordered plugin log (with millisecond offsets) while a shortcut page is opened for the first time.
// The console buffer replay is dropped; only lines after the navigation are shown.
//   node scratch/arch-m0/first_view_log.mjs <appid> [settleMs=10000]
import { pick, session } from "./cdp.mjs";
const APPID = Number(process.argv[2]);
const SETTLE = Number(process.argv[3] || 10000);
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
let live = false;
const t0 = Date.now();
const lines = [];
s.on((m) => {
  if (!live || m.method !== "Runtime.consoleAPICalled") return;
  const text = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").replace(/%c|background:[^;]*;|color:[^;]*;/g, "").replace(/\s+/g, " ").trim();
  if (text.includes("Steam Cartridges")) lines.push(`+${String(Date.now() - t0).padStart(5)}ms ${text.replace("Steam Cartridges", "").trim().slice(0, 130)}`);
});
await s.send("Runtime.enable");
await new Promise((r) => setTimeout(r, 1500));
live = true;
await s.send("Runtime.evaluate", { expression: `SteamUIStore.WindowStore.SteamUIWindows.find(w=>w.Navigator?.AppProperties)?.Navigator.App(${APPID}),1` });
await new Promise((r) => setTimeout(r, SETTLE));
console.log(lines.join("\n"));
process.exit(0);
