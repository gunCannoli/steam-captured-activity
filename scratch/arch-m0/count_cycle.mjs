// M0a verification: count plugin log lines while a shortcut page is open (10 s), then
// while its Properties dialog is open (8 s). Prints PASS when no render loop runs.
//   node scratch/arch-m0/count_cycle.mjs [appid]   (default 4263274102 = AM2R)
import { pick, session } from "./cdp.mjs";
const APPID = Number(process.argv[2] || 4263274102);
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
let phase = "replay";
const counts = {};
const enrichedApps = {}; // phase -> appids enriched (an extra enrichment may be another game's, not a loop)
s.on((m) => {
  if (m.method !== "Runtime.consoleAPICalled") return;
  const text = m.params.args.map((a) => a.value ?? "").join(" ");
  if (!text.includes("Steam Cartridges")) return;
  const enrichedFor = text.match(/Enriched native Game Info & Categories for (\d+)/);
  if (enrichedFor) (enrichedApps[phase] ??= []).push(enrichedFor[1]);
  const key = phase + " :: " + text.replace(/%c|background:[^;]*;|color:[^;]*;/g, "").replace(/\d{6,}/g, "#").replace(/\(".*$/, "").trim().slice(0, 90);
  counts[key] = (counts[key] || 0) + 1;
});
await s.send("Runtime.enable");
await new Promise((r) => setTimeout(r, 1500));
const nav = `SteamUIStore.WindowStore.SteamUIWindows.find(w=>w.Navigator?.AppProperties)?.Navigator`;
phase = "A:page";
s.send("Runtime.evaluate", { expression: `${nav}.App(${APPID}),1` });
await new Promise((r) => setTimeout(r, 10000));
phase = "B:properties";
s.send("Runtime.evaluate", { expression: `setTimeout(()=>${nav}.AppProperties(${APPID}),0),1` });
await new Promise((r) => setTimeout(r, 8000));
for (const [k, v] of Object.entries(counts).filter(([k]) => !k.startsWith("replay")).sort()) console.log(String(v).padStart(5), k);
const sum = (phase, needle) => Object.entries(counts).filter(([k]) => k.startsWith(phase) && k.includes(needle)).reduce((a, [, v]) => a + v, 0);
const enrichA = sum("A:page", "Enriched native Game Info");
const enrichB = sum("B:properties", "Enriched native Game Info");
const achA = sum("A:page", "achievements for shortcut");
const pass = enrichA <= 3 && enrichB <= 3 && achA <= 3;
console.log(`${pass ? "PASS" : "FAIL"} render loop: enrich(page)=${enrichA} enrich(properties)=${enrichB} achievementLoads(page)=${achA} (each must be <= 3)`);
for (const [p, ids] of Object.entries(enrichedApps).filter(([p]) => p !== "replay")) console.log(`enriched appids (${p}): ${ids.join(", ")}`);
process.exit(0);
