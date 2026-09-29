// Live M6 check of the unlock path: trigger one achievement, read Steam's store, reset, read again.
// Restores the shortcut to its earlier unlock state only if it started with none (aborts otherwise).
//   node scratch/arch-m0/ach_trigger_reset.mjs [appid=3048673328]
import { pick, session } from "./cdp.mjs";
const APPID = Number(process.argv[2] || 3048673328);
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
const lines = [];
s.on((m) => {
  if (m.method !== "Runtime.consoleAPICalled") return;
  const text = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").replace(/%c|background:[^;]*;|color:[^;]*;/g, "").trim();
  if (text.includes("Steam Cartridges") && /unlock|Achievements|toast|protobuf|Reset/i.test(text) && text.includes(String(APPID)) || /protobuf/i.test(text)) lines.push(text.slice(0, 150));
});
await s.send("Runtime.enable");
const r = await s.send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `(async () => {
  const P = (PLUGIN_LIST['steam-cartridges-dev'] ?? PLUGIN_LIST['steam-cartridges']);
  const n = () => { const a = P.getLocalAchievements(${APPID}); return a ? { nAchieved: a.nAchieved, nTotal: a.nTotal } : null; };
  const before = n();
  if (!before || before.nAchieved !== 0) return JSON.stringify({ aborted: "expected a loaded shortcut with 0 unlocks", before });
  const triggered = await P.triggerAchievement(${APPID});
  await new Promise((r) => setTimeout(r, 1500));
  const afterTrigger = n();
  const reset = await P.resetAchievements(${APPID});
  await new Promise((r) => setTimeout(r, 1500));
  return JSON.stringify({ before, triggered, afterTrigger, reset, afterReset: n() });
})()` });
console.log(JSON.stringify({ result: JSON.parse(r.result?.result?.value ?? "{}"), log: [...new Set(lines)].slice(-8) }, null, 1));
process.exit(0);
