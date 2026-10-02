// Click-through of the settings panel (M8-2): mounts it attached but off-screen, exercises the safe controls, reverts them.
//   node tests/live/click_settings_panel.mjs [list]
import { pick, session } from "./cdp.mjs";
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
const mode = process.argv[2] || "run";
const expression = `(async () => {
  const P = (window.PLUGIN_LIST || {})['steam-cartridges-dev'] || (window.PLUGIN_LIST || {})['steam-cartridges'];
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px';
  document.body.appendChild(div);
  const R = window.SP_REACTDOM, C = window.SP_REACT;
  const root = R.createRoot(div); root.render(C.createElement(P.SettingsPanel));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  await wait(2500);
  const out = { steps: [] };
  const step = (n, ok, info) => out.steps.push({ n, ok, info });
  const rows = () => [...div.querySelectorAll('*')].filter(e => e.children.length === 0);
  const findText = (re) => rows().find(e => re.test(e.textContent));
  const clickable = (el) => { let e = el; while (e && e !== div) { if (e.onclick || e.getAttribute('role') === 'button' || e.getAttribute('role') === 'switch' || e.tagName === 'BUTTON' || e.className?.toString().includes('Toggle') || e.className?.toString().includes('Button')) return e; e = e.parentElement; } return el; };
  ${"${MODE}"}
  root.unmount(); div.remove();
  return JSON.stringify(out);
})()`;
const body = mode === "list"
  ? `out.buttons = [...div.querySelectorAll('button,[role=button]')].map(e => e.textContent.slice(0,50));`
  : `
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  // 1. Library Audit > Game Data > Manual Edit opens the editor popup (its game filter is there); Escape closes it.
  const pressed = (t) => [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === t);
  const manual = pressed('Manual Edit');
  step('Manual Edit button', !!manual);
  if (manual) {
    click(manual); await wait(800);
    step('Manual Edit opens the Game Data popup', document.body.textContent.includes('Games filter'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await wait(300);
    step('Escape closes the popup', !document.body.textContent.includes('Games filter'));
  }
  // 2. Rules: "+ Add Rule" opens a modal; close it without saving.
  const btn = (t) => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t);
  const add = btn('Add Rule'); step('Add Rule button', !!add);
  if (add) { click(add); await wait(800); const cancel = btn('Cancel'); step('Add Rule modal opens (Cancel present)', !!cancel); if (cancel) { click(cancel); await wait(300); } }
  // 3. Library Analytics: "Review" opens the Review popup, on "Not scraped" when there are no issues but unscraped games;
  //    with a Scrape button there, scrape one game.
  const rev = btn('Review'); step('Review button', !!rev);
  if (rev) {
    click(rev); await wait(1500);
    const done = btn('Done');
    const view = document.body.textContent.match(/(Issues|Not scraped) [(][0-9]+[)]/);
    step('Review popup opens (Done and the view dropdown)', !!done && !!view, view?.[0] ?? 'no view label');
    const scrapes = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Scrape');
    out.scrapeCount = scrapes.length;
    if (scrapes.length) {
      click(scrapes[0]); await wait(300);
      const msg1 = document.body.textContent.match(/Scanning [^.]*[.][.][.]/)?.[0];
      let fin; for (let i = 0; i < 60 && !fin; i++) { await wait(500); fin = document.body.textContent.match(/Scanned [^A-Z]*/)?.[0]; }
      step('Scrape one game: Scanning... then Scanned', !!msg1 && !!fin, [msg1, fin].join(' -> '));
    } else {
      // Nothing to scrape on the view the popup opened on (no unscraped games, or issues to fix first): not a failure.
      step('Scrape one game: skipped, nothing to scrape on ' + (view?.[0] ?? '?'), true);
    }
    const close = [...document.querySelectorAll('button')].find(b => /^(Close|Done|Cancel)$/.test(b.textContent.trim())); if (close) click(close);
    await wait(300);
  }
  // 4. Credential save path: round trip a harmless key through SaveServiceCredentials, then clear it.
  const M = window.Millennium, plug = 'steam-cartridges-dev';
  const rpc = async (payload) => JSON.parse(await M.callServerMethod(plug, 'SaveServiceCredentials', { payload: JSON.stringify(payload) }));
  const a = await rpc({ zz_panel_probe: 'x' }); const b = await rpc({ zz_panel_probe: '' });
  step('SaveServiceCredentials write + clear', a.success === true && b.success === true, JSON.stringify([a, b]));
  `;
const r = await s.send("Runtime.evaluate", { expression: expression.replace("${MODE}", body), awaitPromise: true, returnByValue: true });
console.log(r.result?.result?.value ?? JSON.stringify(r.result).slice(0, 600));
process.exit(0);
