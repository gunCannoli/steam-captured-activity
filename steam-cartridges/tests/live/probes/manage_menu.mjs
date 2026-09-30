// Opens a shortcut's Manage (gear) menu on the desktop window, lists the items with their disabled state, closes it.
// Needs Steam on the desktop (not Big Picture). Navigates the main window to the app and back to where it was.
//   node tests/live/probes/manage_menu.mjs [appid=4263274102]
import { pick, session } from "../cdp.mjs";
const appid = process.argv[2] ?? "4263274102";
const shared = session((await pick("SharedJSContext")).webSocketDebuggerUrl); await shared.ready;
const desk = session((await pick((t) => t.title === "Steam" && t.url.includes("minwidth=1010"))).webSocketDebuggerUrl); await desk.ready;
const ev = async (s, expression) => (await s.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const prev = await ev(shared, `MainWindowBrowserManager.m_lastLocation?.pathname`);
await ev(shared, `SteamUIStore.WindowStore.MainWindowInstance.Navigator.App(${appid}), true`);
await new Promise((r) => setTimeout(r, 3500));
const out = await ev(desk, `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const btn = document.querySelector('[aria-label="Manage"]');
  if (!btn) return JSON.stringify({ error: 'no Manage button' });
  btn.click(); await wait(800);
  const manage = [...document.querySelectorAll('[class*="MenuItem" i],[class*="contextMenuItem" i]')].find(e => e.textContent.trim() === 'Manage');
  if (manage) { manage.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); manage.click(); await wait(800); }
  const items = [...document.querySelectorAll('[class*="contextMenuItem" i],[class*="MenuItem" i]')].map(e => ({ t: e.textContent.trim().slice(0, 60), disabled: /disabled/i.test(e.className) })).filter(x => x.t);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return JSON.stringify({ items });
})()`);
console.log(out);
const item = JSON.parse(out).items?.find((i) => i.t.startsWith('Mark as Private'));
const ok = item?.disabled === true;
console.log(ok ? 'PASS K4 Mark as Private is disabled for a shortcut' : 'FAIL K4 Mark as Private is enabled (or the menu did not open)');
if (prev) await ev(shared, `MainWindowBrowserManager.m_history.push(${JSON.stringify(prev)}), true`);
process.exit(ok ? 0 : 1);
