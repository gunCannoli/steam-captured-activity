// Consistency plan stage A (docs/plans/enhanced-notifications-consistency-plan.md § 5, A2/A3). Hold the Steam lock; Big Picture with a game running.
// Usage: node tests/probes/ingame-views.mjs <ms> "TestAchievement(435150);TestDownloadComplete(435150)" [out]
// A2: trace both Big Picture toast views (Big Picture's own and the game overlay's) while a game runs.
import { connect } from "../cdp.mjs";
import { writeFileSync } from "node:fs";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const s = await connect();
const ms = Number(process.argv[2] ?? 20000);
const fires = (process.argv[3] ?? "TestDownloadComplete(435150);TestAchievement(435150)").split(";");
const out = process.argv[4] ?? new URL("../../../scratch/en-spikes/A2-dual.txt", import.meta.url);
const r = await s.evaluate(`(() => {
  const log = (window.__dt = []); const t0 = performance.now(); const at = () => Math.round(performance.now() - t0); window.__dtAt = at;
  const undo = (window.__dtUndo = []); const views = [];
  for (const p of g_PopupManager.GetPopups()) {
    const doc = p.window?.document; const el = doc?.querySelector('[class*="GamepadToastPlaceholder"]'); if (!el) continue;
    const k = Object.keys(el).find((x) => x.startsWith('__reactFiber')); let po = null;
    for (let f = el[k], d = 0; f && d < 4 && !po; f = f.return, d++) for (let h = f.memoizedState, i = 0; h && i < 16; h = h.next, i++) if (h.memoizedState?.GetBrowserView) { po = h.memoizedState; break; }
    if (!po) continue;
    const tag = /Overlay/.test(doc.title) ? 'OV' : 'BP';
    const bv = po.GetBrowserView(); const view = po.GetViewWindow();
    for (const m of ['SetBounds', 'SetVisible']) { const orig = bv[m]; const own = Object.prototype.hasOwnProperty.call(bv, m);
      bv[m] = function (...a) { log.push({ t: at(), v: tag, ev: m, a: a.map(x => typeof x === 'number' ? Math.round(x) : x) }); return orig.apply(this, a); };
      undo.push(() => { if (own) bv[m] = orig; else delete bv[m]; }); }
    views.push({ tag, win: p.window, view });
  }
  const store = NotificationStore; const prevPop = Object.prototype.hasOwnProperty.call(store, 'PopNextToastNotification') ? store.PopNextToastNotification : null;
  const curPop = store.PopNextToastNotification;
  store.PopNextToastNotification = function (ctx) { const n = curPop.apply(this, arguments); log.push({ t: at(), ev: 'pop', ctx: ctx ?? null, eType: n?.eType ?? null }); return n; };
  undo.push(() => { if (prevPop) store.PopNextToastNotification = prevPop; else delete store.PopNextToastNotification; });
  const last = {};
  const snap = () => { for (const v of views) {
    const doc = v.win.document; const el = doc.querySelector('[class*="GamepadToastPlaceholder"]'); const rc = el?.getBoundingClientRect();
    const tpl = v.view?.document?.querySelector('[class*="GamepadToastPopup"] > *'); const cs = tpl && v.view.getComputedStyle(tpl);
    const cur = {
      ph: el ? [rc.x, rc.y, rc.width, rc.height].map(Math.round).join(',') + ',' + v.win.getComputedStyle(el).display : null,
      cls: el?.className.split(' ').filter((c) => !c.startsWith('_')).join(' '),
      place: !!doc.getElementById('enhanced-notifications-placement'),
      theme: !!v.view?.document?.getElementById('enhanced-notifications-theme'),
      view: v.view ? [v.view.screenX - v.win.screenX, v.view.screenY - v.win.screenY, v.view.innerWidth, v.view.innerHeight].join(',') : null,
      type: v.view?.document?.body?.getAttribute('data-en-type') ?? null,
      tpl: tpl ? tpl.className.split(' ').filter((c) => !c.startsWith('_')).slice(0, 4).join(' ') : null,
      anim: cs ? cs.animationName : null,
      op: cs ? Math.round(Number(cs.opacity) * 4) / 4 : null,
    };
    const L = (last[v.tag] ||= {});
    for (const key of Object.keys(cur)) if (cur[key] !== L[key]) { log.push({ t: at(), v: v.tag, ev: key, val: cur[key] }); L[key] = cur[key]; }
  } };
  const timer = setInterval(() => { try { snap(); } catch (e) { log.push({ t: at(), ev: 'err', val: String(e) }); } }, 8);
  undo.push(() => clearInterval(timer));
  return JSON.stringify(views.map((v) => v.tag + ':' + v.view?.name));
})()`);
console.log("views:", r);
for (const f of fires) { await s.evaluate(`(window.__dt.push({ t: window.__dtAt(), ev: "mark", val: ${JSON.stringify(f)} }), NotificationStore.${f}, true)`); await wait(200); continue;
  await s.evaluate(`(window.__dt.push({ t: window.__dtAt(), ev: 'mark', val: ${JSON.stringify(f)} }), NotificationStore.${f}, true)`); await wait(7000); }
await wait(Math.max(0, ms - fires.length * 7000));
const log = JSON.parse(await s.evaluate(`(() => { for (const u of window.__dtUndo.reverse()) try { u(); } catch {} return JSON.stringify(window.__dt); })()`));
writeFileSync(out, log.map((e) => JSON.stringify(e)).join("\n"));
console.log(log.length, "events ->", out);
s.close();
