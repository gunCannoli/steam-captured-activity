// Consistency plan B5: does a toast get stuck in Big Picture, and does Steam's own onDismiss clear it? (the watchdog's spike)
// Usage (Big Picture open, a game running): node tests/probes/toast-watchdog.mjs, then switch to the game within 10 s.
// Env: DELAY_MS (10000), FORCE (1: call onDismiss on a stuck toast; 0: only watch), GRACE_MS (2000), RUN_MS (60000).
// Takes the Steam lock itself unless STEAM_LOCK_OWNER is set. Every wrapper is removed at the end.
import { connect } from "../cdp.mjs";
import { acquire, release } from "../../../steam-lock.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DELAY = Number(process.env.DELAY_MS ?? 10000);
const FORCE = process.env.FORCE !== "0";
const GRACE = Number(process.env.GRACE_MS ?? 2000);
const RUN = Number(process.env.RUN_MS ?? 60000);
const FIRES = ["TestDownloadComplete(435150)", "TestAchievement(435150)", "TestDownloadComplete(435150)"];
const owner = process.env.STEAM_LOCK_OWNER ?? `watchdog-probe-${Date.now()}`;
const ownLock = !process.env.STEAM_LOCK_OWNER;

if (ownLock) await acquire({ owner, purpose: "enhanced-notifications: toast watchdog probe" });
let s;
try {
  s = await connect();
  const views = await s.evaluate(`(() => {
    const views = [];
    for (const p of g_PopupManager.GetPopups()) {
      const doc = p.window?.document; const el = doc?.querySelector('[class*="GamepadToastPlaceholder"]'); if (!el) continue;
      const k = Object.keys(el).find((x) => x.startsWith('__reactFiber')); let po = null;
      for (let f = el[k], d = 0; f && d < 4 && !po; f = f.return, d++) for (let h = f.memoizedState, i = 0; h && i < 16; h = h.next, i++) if (h.memoizedState?.GetViewWindow) { po = h.memoizedState; break; }
      if (po) views.push({ tag: /Overlay/.test(doc.title) ? 'OV' : 'BP', win: p.window, po });
    }
    window.__wd = { views, log: [], toasts: new Map(), undo: [] };
    return views.map((v) => v.tag);
  })()`);
  if (!views.length) {
    console.log("No Big Picture toast view found: open Big Picture (and a game) first.");
    process.exitCode = 1;
  } else {
    console.log(`Toast views: ${views.join(", ")}. Starting in ${DELAY / 1000} s: switch to the game now.`);
    await wait(DELAY);
    await s.evaluate(`(() => {
      const W = window.__wd; const t0 = performance.now(); const at = () => Math.round(performance.now() - t0); W.at = at;
      const FORCE = ${FORCE}, GRACE = ${GRACE};
      const focused = () => [...SteamUIStore.WindowStore.SteamUIWindows].map((w) => w?.m_CompositionStateStore?.m_currentlyFocusedAppid?.Value).find((v) => typeof v === 'number') ?? null;
      W.focused = focused;
      const entry = (n) => { let e = W.toasts.get(n); if (!e) { e = { id: n.notificationID, eType: n.eType, dur: n.nToastDurationMS || 5000 }; W.toasts.set(n, e); } return e; };
      const store = NotificationStore; const own = Object.prototype.hasOwnProperty.call(store, 'PopNextToastNotification');
      const prev = store.PopNextToastNotification; const cur = prev;
      store.PopNextToastNotification = function () { const n = cur.apply(this, arguments); if (n) entry(n).popped = at(); return n; };
      W.undo.push(() => { if (own) store.PopNextToastNotification = prev; else delete store.PopNextToastNotification; });
      // The toast element's fiber holds Steam's { notification, onDismiss } (the container's own dismiss).
      const shown = (v) => {
        const doc = v.po.GetViewWindow()?.document; const el = doc?.querySelector('[class*="GamepadToastPopup"]'); if (!el) return null;
        const k = Object.keys(el).find((x) => x.startsWith('__reactFiber'));
        for (let f = el[k], d = 0; f && d < 40; f = f.return, d++) { const p = f.memoizedProps; if (p?.notification && typeof p.onDismiss === 'function') return p; }
        return null;
      };
      const tick = () => {
        const now = at();
        for (const v of W.views) {
          const p = shown(v); const n = p?.notification ?? null;
          if (v.current && v.current !== n) { const e = entry(v.current); if (e.gone === undefined) e.gone = now; }
          v.current = n;
          if (!n) continue;
          const e = entry(n);
          if (e.shown === undefined) { e.shown = now; e.view = v.tag; e.bpHidden = v.win.document.visibilityState === 'hidden'; }
          const limit = e.dur + 3000 + GRACE; // Steam: display + animations + 1 s before the list drops it
          if (now - e.shown > limit && e.stuck === undefined) {
            e.stuck = now;
            if (FORCE) { e.forced = now; try { p.onDismiss(); } catch (err) { e.forceError = String(err); } }
          }
        }
      };
      const timer = setInterval(() => { try { tick(); } catch (err) { W.log.push(String(err)); } }, 100);
      W.undo.push(() => clearInterval(timer));
      return true;
    })()`);
    for (const f of FIRES) {
      const focused = await s.evaluate(`(window.__wd.log.push({ fire: ${JSON.stringify(f)}, t: window.__wd.at(), focused: window.__wd.focused() }), window.__wd.focused())`);
      await s.evaluate(`(NotificationStore.${f}, true)`);
      console.log(`fired ${f} (focused app ${focused})`);
      await wait(200);
    }
    // Until every popped toast is gone (or RUN_MS).
    const started = Date.now();
    for (;;) {
      await wait(1000);
      const open = await s.evaluate(`[...window.__wd.toasts.values()].filter((e) => e.gone === undefined).length`);
      if ((open === 0 && Date.now() - started > 3000) || Date.now() - started > RUN) break;
    }
    const result = JSON.parse(await s.evaluate(`(() => { const W = window.__wd; for (const u of W.undo.reverse()) try { u(); } catch {} return JSON.stringify({ log: W.log, toasts: [...W.toasts.values()] }); })()`));
    const names = { 1: "download", 5: "achievement" };
    console.log("\ntoast        view  on screen    verdict");
    let stuck = 0, cleared = 0;
    for (const e of result.toasts) {
      const life = e.shown === undefined ? null : (e.gone ?? Math.round(RUN)) - e.shown;
      let verdict = "ok";
      if (e.shown === undefined) verdict = "never shown";
      else if (e.stuck !== undefined) {
        stuck++;
        const after = e.gone !== undefined ? e.gone - e.forced : null;
        if (!FORCE) verdict = "STUCK";
        else if (after !== null && after <= 3000) { cleared++; verdict = `STUCK, forced away (${after} ms)`; }
        else verdict = `STUCK, forcing did not clear it${e.forceError ? ": " + e.forceError : ""}`;
      } else if (e.gone === undefined) verdict = "still on screen";
      console.log(`${(names[e.eType] ?? "type " + e.eType).padEnd(12)} ${(e.view ?? "-").padEnd(5)} ${life === null ? "-".padEnd(12) : (life / 1000).toFixed(1).padStart(6) + " s     "} ${verdict}${e.bpHidden ? " (window hidden)" : ""}`);
    }
    console.log(`\nRESULT: ${stuck === 0 ? "no toast got stuck" : FORCE ? `${stuck} stuck, ${cleared} cleared by Steam's onDismiss` : `${stuck} stuck`}`);
    const dir = new URL("../../../scratch/en-spikes/", import.meta.url);
    mkdirSync(dir, { recursive: true });
    const out = new URL(`watchdog-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, dir);
    writeFileSync(out, JSON.stringify(result, null, 1));
    console.log(`Details: ${out.pathname.slice(1)}`);
  }
} finally {
  s?.close();
  if (ownLock) release({ owner });
}
