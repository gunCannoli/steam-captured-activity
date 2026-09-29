// Read-only: open a shortcut page and print every unhandled exception/rejection (text, url, first stack frames).
//   node scratch/arch-m0/exceptions_all.mjs <appid> [settleMs=8000]
import { pick, session } from "./cdp.mjs";
const APPID = Number(process.argv[2]);
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
const out = [];
s.on((m) => { if (m.method === "Runtime.exceptionThrown") { const e = m.params.exceptionDetails; out.push({ text: e.text, url: e.url, line: e.lineNumber, value: e.exception?.value ?? e.exception?.description, frames: (e.stackTrace?.callFrames ?? []).slice(0, 3).map((f) => `${f.functionName || "(anon)"} ${(f.url || "").split("/").pop()}:${f.lineNumber}`) }); } });
await s.send("Runtime.enable");
await s.send("Runtime.evaluate", { expression: `SteamUIStore.WindowStore.SteamUIWindows.find(w=>w.Navigator?.AppProperties)?.Navigator.App(${APPID}),1` });
await new Promise((r) => setTimeout(r, Number(process.argv[3] || 8000)));
console.log(JSON.stringify(out, null, 1));
process.exit(0);
