// Read-only: mount the plugin's SettingsPanel into a detached div and check every section title renders.
//   node tests/live/check_settings_panel.mjs
import { pick, session } from "./cdp.mjs";
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
const titles = ["Metadata", "Game Data", "Achievements", "Notifications", "Activity Feed", "Community & Media", "Routing Rules", "Library Audit", "Manual Edit"];
const expression = `(async () => {
  const P = (window.PLUGIN_LIST || {})['steam-cartridges-dev'] || (window.PLUGIN_LIST || {})['steam-cartridges'];
  if (!P || !P.SettingsPanel) return JSON.stringify({ error: 'SettingsPanel not exported' });
  const div = document.createElement('div');
  const R = window.SP_REACTDOM, C = window.SP_REACT;
  let root = null;
  if (R.createRoot) { root = R.createRoot(div); root.render(C.createElement(P.SettingsPanel)); } else R.render(C.createElement(P.SettingsPanel), div);
  await new Promise(r => setTimeout(r, 3000));
  const text = div.textContent;
  if (root) root.unmount(); else R.unmountComponentAtNode(div);
  return JSON.stringify({ text });
})()`;
const r = await s.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
const out = JSON.parse(r.result?.result?.value ?? "{}");
if (out.error || !out.text) { console.log("FAIL", out.error ?? JSON.stringify(r.result).slice(0, 300)); process.exit(1); }
let bad = 0;
for (const title of titles) { const ok = out.text.includes(title); if (!ok) bad++; console.log((ok ? "PASS " : "FAIL ") + title); }
process.exit(bad ? 1 : 0);
