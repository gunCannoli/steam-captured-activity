// Read-only: mount the plugin's SettingsPanel into a detached div and check every section title renders.
//   node tests/live/check_settings_panel.mjs
import { pick, session } from "./cdp.mjs";
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
const titles = ["Metadata", "Edit Game MetaData", "Achievements", "Notifications", "Activity Feed", "Community Content", "Routing Rules", "Library Analytics", "Manual Edit"];
const expression = `(async () => {
  const P = (window.PLUGIN_LIST || {})['steam-cartridges-dev'] || (window.PLUGIN_LIST || {})['steam-cartridges'];
  if (!P || !P.SettingsPanel) return JSON.stringify({ error: 'SettingsPanel not exported' });
  const div = document.createElement('div');
  const R = window.SP_REACTDOM, C = window.SP_REACT;
  let root = null;
  if (R.createRoot) { root = R.createRoot(div); root.render(C.createElement(P.SettingsPanel)); } else R.render(C.createElement(P.SettingsPanel), div);
  await new Promise(r => setTimeout(r, 3000));
  const text = div.textContent;
  // ADR-0051: the "Cache lifespan" slider shows the current days.
  const sliders = div.querySelectorAll('[class*="Slider"]').length;
  if (root) root.unmount(); else R.unmountComponentAtNode(div);
  return JSON.stringify({ text, sliders });
})()`;
const r = await s.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
const out = JSON.parse(r.result?.result?.value ?? "{}");
if (out.error || !out.text) { console.log("FAIL", out.error ?? JSON.stringify(r.result).slice(0, 300)); process.exit(1); }
let bad = 0;
for (const title of titles) { const ok = out.text.includes(title); if (!ok) bad++; console.log((ok ? "PASS " : "FAIL ") + title); }
// ADR-0051: Community & Media has the "Cache lifespan" slider, showing its value in days.
const slider = out.text.includes("Cache lifespan") && /\d+ days?/.test(out.text) && out.sliders > 0;
if (!slider) bad++;
console.log((slider ? "PASS " : "FAIL ") + `Cache lifespan slider (${out.sliders} slider element(s), value ${out.text.match(/\d+ days?/)?.[0] ?? "none"})`);
process.exit(bad ? 1 : 0);
