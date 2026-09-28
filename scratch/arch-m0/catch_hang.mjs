// Attach the debugger while SharedJSContext is healthy, open Properties, then pause the
// hung thread and print each sampled stack (top + bottom) with script URLs.
//   node scratch/arch-m0/catch_hang.mjs <appid>   (hangs Steam if the bug is present; restart after)
import { pick, session } from "./cdp.mjs";
const APPID = Number(process.argv[2] || 4263274102);
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
const scripts = new Map();
let onPause;
s.on((m) => {
  if (m.method === "Debugger.scriptParsed") scripts.set(m.params.scriptId, m.params.url);
  if (m.method === "Debugger.paused") onPause?.(m.params);
});
await s.send("Debugger.enable");
await s.send("Debugger.setAsyncCallStackDepth", { maxDepth: 8 });
const nav = `SteamUIStore.WindowStore.SteamUIWindows.find(w=>w.Navigator?.AppProperties)?.Navigator`;
s.send("Runtime.evaluate", { expression: `${nav}.App(${APPID}),1` });
await new Promise((r) => setTimeout(r, 4000));
s.send("Runtime.evaluate", { expression: `setTimeout(()=>${nav}.AppProperties(${APPID}),0),1` });
await new Promise((r) => setTimeout(r, 2500));
const fmt = (f) => `${f.functionName || "(anon)"} @ [${f.location.scriptId}]${(scripts.get(f.location.scriptId) || "").split("/").slice(-2).join("/").slice(0, 80)}:${f.location.lineNumber + 1}:${f.location.columnNumber + 1}`;
for (let i = 0; i < 3; i++) {
  const p = new Promise((r) => (onPause = r));
  s.send("Debugger.pause");
  const params = await Promise.race([p, new Promise((r) => setTimeout(() => r(null), 6000))]);
  if (!params) { console.log(`sample ${i}: no pause`); continue; }
  const cf = params.callFrames;
  console.log(`--- sample ${i}: ${cf.length} frames`);
  const fnCount = {};
  for (const f of cf) { const k = fmt(f); fnCount[k] = (fnCount[k] || 0) + 1; }
  console.log(" most repeated:", Object.entries(fnCount).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => v + "x " + k).join("\n   "));
  console.log(" top 8:"); cf.slice(0, 8).forEach((f) => console.log("   " + fmt(f)));
  console.log(" bottom 30:"); cf.slice(-30).forEach((f) => console.log("   " + fmt(f)));
  if (params.asyncStackTrace) console.log(" async:", params.asyncStackTrace.description, params.asyncStackTrace.callFrames.slice(0, 6).map((f) => f.functionName + "@" + f.url.split("/").pop() + ":" + f.lineNumber).join(" < "));
  s.send("Debugger.resume");
  await new Promise((r) => setTimeout(r, 700));
}
console.log("scripts of interest:", [...scripts].filter(([id]) => ["6", "18", "32", "34"].includes(id)).map(([id, u]) => id + "=" + u.slice(0, 140)).join("\n  "));
process.exit(0);
