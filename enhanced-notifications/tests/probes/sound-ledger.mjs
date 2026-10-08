// A4: a sound ledger. Records, with times: each toast's arrival and pop (context), every PlayNotificationSound call
// Steam makes, every native PlayNavSound dispatch, every WebAudio buffer start (our clips), every rate-limit answer.
// Captures on unlock run in dry-run (no real screenshot or clip). Everything wrapped is restored at the end.
import { connect } from "../cdp.mjs";
import { writeFileSync } from "node:fs";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const s = await connect();
const PLUGIN = "enhanced-notifications-dev";
const label = process.argv[2] ?? "burst";
const plan = (process.argv[3] ?? "TestAchievement(435150)|0;TestDownloadComplete(435150)|200;TestFriendOnline()|200").split(";");
const tail = Number(process.argv[4] ?? 14000);
const out = new URL(`../../../scratch/en-spikes/A4-${label}.txt`, import.meta.url);

await s.evaluate(`window.PLUGIN_LIST['${PLUGIN}'].setCaptureDryRun(true)`);
const installed = await s.evaluate(`(() => {
  const log = (window.__sl = []); const t0 = performance.now(); const at = () => Math.round(performance.now() - t0); window.__slAt = at;
  const undo = (window.__slUndo = []);
  const wrapOwn = (obj, key, fn) => { const own = Object.prototype.hasOwnProperty.call(obj, key); const orig = obj[key];
    obj[key] = function (...a) { return fn.call(this, orig, a); }; undo.push(() => { if (own) obj[key] = orig; else delete obj[key]; }); };
  const store = NotificationStore;
  wrapOwn(store, 'PlayNotificationSound', function (orig, a) { log.push({ t: at(), ev: 'PlayNotificationSound', eType: a[0]?.eType }); return orig.apply(this, a); });
  wrapOwn(store, 'PopNextToastNotification', function (orig, a) { const n = orig.apply(this, a); if (n) log.push({ t: at(), ev: 'pop', ctx: a[0] ?? 0, eType: n.eType }); return n; });
  wrapOwn(store, 'BIsToastRateLimited', function (orig, a) { const r = orig.apply(this, a); log.push({ t: at(), ev: 'rateLimited', args: a.map(String), r }); return r; });
  const sub = store.CurrentToastSubscribableValue.Subscribe((n) => n && log.push({ t: at(), ev: 'arrival', eType: n.eType }));
  undo.push(() => sub.Unsubscribe());
  // The native sound player: the module export with PlayNavSound (OnScreenshotStarted calls it).
  let nav = null;
  try {
    const req = (() => { let r; window.webpackChunksteamui.push([[Symbol('sl')], {}, (x) => { r = x; }]); return r; })();
    for (const id of Object.keys(req.m)) { let m; try { m = req(id); } catch { continue; }
      for (const v of Object.values(m || {})) if (v && typeof v.PlayNavSound === 'function') { nav = v; break; }
      if (nav) break; }
  } catch (e) { log.push({ t: at(), ev: 'navSearchError', v: String(e) }); }
  if (nav) wrapOwn(nav, 'PlayNavSound', function (orig, a) { log.push({ t: at(), ev: 'PlayNavSound', id: a[0] }); return orig.apply(this, a); });
  const src = AudioBufferSourceNode.prototype;
  const origStart = src.start;
  src.start = function (...a) { log.push({ t: at(), ev: 'clipStart', durMs: Math.round((this.buffer?.duration ?? 0) * 1000) }); return origStart.apply(this, a); };
  undo.push(() => { src.start = origStart; });
  return 'ok nav=' + !!nav;
})()`);
console.log("installed:", installed);
for (const step of plan) {
  const [call, gap] = step.split("|");
  await wait(Number(gap ?? 0));
  await s.evaluate(`(window.__sl.push({ t: window.__slAt(), ev: 'fire', v: ${JSON.stringify(call)} }), NotificationStore.${call}, true)`);
}
await wait(tail);
const log = JSON.parse(await s.evaluate(`(() => { for (const u of window.__slUndo.reverse()) try { u(); } catch {} return JSON.stringify(window.__sl); })()`));
await s.evaluate(`window.PLUGIN_LIST['${PLUGIN}'].setCaptureDryRun(false)`);
writeFileSync(out, log.map((e) => JSON.stringify(e)).join("\n"));
for (const e of log) console.log(JSON.stringify(e));
s.close();
