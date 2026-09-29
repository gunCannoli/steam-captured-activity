// K17 live check: dispatch one achievement toast through the plugin's public API and report whether it resolved,
// the plugin's log lines, and any CDP target (window) that appeared while the toast showed.
//   node scratch/arch-m0/toast_live.mjs [shortcutAppid=3048673328]
import { pick, session } from "./cdp.mjs";
const APPID = Number(process.argv[2] || 3048673328);
const list = async () => (await (await fetch("http://127.0.0.1:8080/json")).json()).map((t) => `${t.title}|${(t.url || "").replace(/\?.*/, "").split("/").slice(-2).join("/")}`);
const before = await list();
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
const lines = [];
s.on((m) => {
  if (m.method !== "Runtime.consoleAPICalled") return;
  const text = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").replace(/%c|background:[^;]*;|color:[^;]*;/g, "").replace(/\s+/g, " ").trim();
  if (text.includes("Steam Cartridges") && /toast|protobuf|notification/i.test(text)) lines.push(text.slice(0, 160));
});
await s.send("Runtime.enable");
const r = await s.send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `(() => { const P = (PLUGIN_LIST['steam-cartridges-dev'] ?? PLUGIN_LIST['steam-cartridges']); return P.dispatchAchievementToast(${APPID}, { id: 'toast_probe', name: 'Toast probe', description: 'M6 K17 live check', icon: 'https://media.retroachievements.org/Badge/00001.png', global_pct: 12.5 }); })()` });
const during = [];
for (let i = 0; i < 6; i++) { await new Promise((x) => setTimeout(x, 500)); during.push(...(await list())); }
const appeared = [...new Set(during)].filter((x) => !before.includes(x));
console.log(JSON.stringify({ returned: r.result?.result?.value, log: [...new Set(lines)], newTargets: appeared }, null, 1));
process.exit(0);
