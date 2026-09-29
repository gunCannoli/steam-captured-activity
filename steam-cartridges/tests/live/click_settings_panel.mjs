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
  const checkboxFor = (label) => {
    const el = [...div.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === label);
    let e = el; while (e && e !== div) { const c = e.querySelector && e.querySelector('[role=checkbox]'); if (c) return c; e = e.parentElement; }
  };
  const stateOf = (id) => (div.textContent.match(new RegExp(id + ': (on|off|tripped)')) || [])[1];
  // 1. Troubleshooting toggle writes disabledFeatures and the state line follows; then revert.
  const cb = checkboxFor('toasts');
  step('toasts toggle found', !!cb);
  if (cb) {
    const before = stateOf('toasts'); click(cb); await wait(1200);
    const mid = stateOf('toasts'); click(checkboxFor('toasts')); await wait(3000);
    const after = stateOf('toasts');
    step('toasts on -> off -> on', before === 'on' && mid === 'off' && after === 'on', [before, mid, after].join(','));
  }
  // 2. Rules: "+ Add Rule" opens a modal; close it without saving.
  const btn = (t) => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t);
  const add = btn('+ Add Rule'); step('Add Rule button', !!add);
  if (add) { click(add); await wait(800); const cancel = btn('Cancel'); step('Add Rule modal opens (Cancel present)', !!cancel); if (cancel) { click(cancel); await wait(300); } }
  // 3. Audit: "Review" opens the audit modal; look for per-game Scan buttons.
  const rev = btn('Review'); step('Review button', !!rev);
  if (rev) {
    click(rev); await wait(1500);
    const scans = [...document.querySelectorAll('button')].filter(b => /scan/i.test(b.textContent));
    step('Audit modal lists Scan buttons', scans.length > 0, scans.length + ' scan button(s); ' + [...new Set([...document.querySelectorAll('button')].map(b => b.textContent.trim().slice(0, 20)))].slice(0, 20).join(' | '));
    out.scanCount = scans.length;
    if (scans.length) {
      click(scans[0]); await wait(300);
      const msg1 = document.body.textContent.match(/Scanning [^.]*\.\.\./)?.[0];
      let done; for (let i = 0; i < 60 && !done; i++) { await wait(500); done = document.body.textContent.match(/Scanned [^A-Z]*/)?.[0]; }
      step('Scan single: Scanning... then Scanned', !!msg1 && !!done, [msg1, done].join(' -> '));
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
