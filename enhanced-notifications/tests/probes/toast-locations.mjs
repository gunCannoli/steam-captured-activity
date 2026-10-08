// Consistency plan B3 spike: when does Steam (re)create the Big Picture toast containers, and with which props?
// Logs every jsx element whose type is a toast-location component (source has `ge("notificationtoasts",` or the
// `bFocusedLocation` prop), with its appid and bFocusedLocation, while a game is launched and quit. Read-only: a
// logging wrapper on react/jsx-runtime's jsx/jsxs for the duration, removed at the end.
// Usage (Big Picture open, Steam lock held): node tests/probes/toast-locations.mjs [appid=4263274102] [ms=45000]
import { connect } from '../cdp.mjs';
import { writeFileSync } from 'node:fs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const APPID = BigInt(process.argv[2] ?? '4263274102');
const MS = Number(process.argv[3] ?? 45000);
const gid = ((APPID << 32n) | 0x02000000n).toString();
const s = await connect();

const installed = await s.evaluate(`(() => {
    const log = (window.__tl = []); const t0 = performance.now(); const at = () => Math.round(performance.now() - t0); window.__tlAt = at;
    let req; window.webpackChunksteamui.push([[Symbol('tl')], {}, (x) => { req = x; }]);
    let runtime = null;
    for (const id of Object.keys(req.m)) {
        let m; try { m = req(id); } catch { continue; }
        if (m && typeof m.jsx === 'function' && typeof m.jsxs === 'function' && m.Fragment) { runtime = m; break; }
    }
    if (!runtime) return 'no jsx runtime';
    const isLocation = (type) => {
        if (typeof type !== 'function') return false;
        if (type.__tlChecked !== undefined) return type.__tlChecked;
        const src = String(type);
        return (type.__tlChecked = src.includes('ge("notificationtoasts"') || src.includes('bFocusedLocation:'));
    };
    const undo = (window.__tlUndo = []);
    for (const k of ['jsx', 'jsxs']) {
        const orig = runtime[k];
        const wrapped = function (type, props, key) {
            try {
                if (isLocation(type)) log.push({ t: at(), ev: 'element', fn: (type.name || '?') + '/' + String(type).length, appid: props?.appid ?? null, focused: props?.bFocusedLocation ?? null });
            } catch {}
            return orig.apply(this, arguments);
        };
        try { runtime[k] = wrapped; undo.push(() => { if (runtime[k] === wrapped) runtime[k] = orig; }); } catch (e) { log.push({ t: at(), ev: 'patchError', v: String(e) }); }
    }
    return 'ok';
})()`);
console.log('installed:', installed);
const mark = (v) => s.evaluate(`(window.__tl.push({ t: window.__tlAt(), ev: 'mark', v: ${JSON.stringify(v)} }), true)`);
await wait(3000);
await mark('launch');
await s.evaluate(`(SteamClient.Apps.RunGame('${gid}', '', -1, 100), true)`);
await wait(Math.floor(MS / 2));
await mark('toast while running');
await s.evaluate(`(NotificationStore.TestDownloadComplete(435150), true)`);
await wait(6000);
await mark('quit');
await s.evaluate(`(SteamClient.Apps.TerminateApp('${gid}', false), true)`);
await wait(Math.floor(MS / 2) - 6000);
await mark('toast after quit');
await s.evaluate(`(NotificationStore.TestDownloadComplete(435150), true)`);
await wait(6000);
const log = JSON.parse(await s.evaluate(`(() => { for (const u of window.__tlUndo.reverse()) try { u(); } catch {} return JSON.stringify(window.__tl); })()`));
const out = new URL('../../../scratch/en-spikes/B3-locations.txt', import.meta.url);
writeFileSync(out, log.map((e) => JSON.stringify(e)).join('\n'));
for (const e of log) console.log(JSON.stringify(e));
s.close();
