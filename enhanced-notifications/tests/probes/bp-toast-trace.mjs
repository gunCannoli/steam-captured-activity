// Debug probe, Big Picture only: traces how Steam places and shows its one Big Picture toast view, per frame, so a
// flicker or a jump back to Steam's corner can be pinned to its cause. Records, with a timestamp:
// - every `SetBounds` / `SetVisible` Steam (or anyone) sends to the toast BrowserView (wrapped on the instance);
// - every change of the `GamepadToastPlaceholder` div: its rect, `display`, classes, inline style;
// - every change of our `<style id=enhanced-notifications-placement>` in the Big Picture window (added, text, removed);
// - every change of the toast view: `data-en-type`, the `.GamepadToastPopup > *` element, its classes, animation and opacity;
// - NotificationStore's current toast;
// - the plugin's own Big Picture trace (`bigPictureTrace()`: arrival / shown / attr / placement / scan), merged in by time.
// Big Picture must be in front: a hidden window does not paint, so its animations never start (a warning is printed).
// Sampled every 8 ms from a SharedJSContext timer; also logs the Big Picture window's visibility (a change re-measures).
//
// Usage (Big Picture open):
//   node tests/probes/bp-toast-trace.mjs                       # the active theme, one toast
//   node tests/probes/bp-toast-trace.mjs --theme top_left:ps5  # a temporary theme (deleted afterwards)
//   node tests/probes/bp-toast-trace.mjs --theme top_left:ps5 --pattern burst   # 3 toasts 150 ms apart
//   --pattern theme-switch   one toast, switch theme mid-toast, one more toast
//   --pattern first          switch to the theme right before the first toast (placement not yet applied)
//   --pattern mixed          a Warning-class toast (LowBattery, smaller placeholder), a download, an achievement
//                            (drawn by enhanced-achievements when it claims the banner), 7 s apart
//   --pattern queue          an achievement queued behind a download, then a download queued behind an achievement:
//                            shows whether the showing toast's styling changes when the next one arrives
//   --pattern fresh          remove our placement <style> from the Big Picture window first (as in a Big Picture
//                            window opened after start-up), then one toast: is the style back before Steam measures?
//   --source arrival|shown|pop   where the plugin takes Big Picture's toast type from (frontend/surfaces/style/bp-debug.ts):
//                            arrival = today's behaviour; shown = only the shared hook's onShown; pop = this probe wraps
//                            NotificationStore.PopNextToastNotification (the moment Steam hands a toast to the view,
//                            before it renders) and feeds the plugin's `manual` type. Reset to arrival afterwards.
//   --ms 15000               how long to record
import { rmSync, writeFileSync } from 'node:fs';
import { connect, resolvePluginName } from '../cdp.mjs';

const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : dflt;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const s = await connect();
const PLUGIN = await resolvePluginName(s, 'EN_PLUGIN', 'enhanced-notifications');
const plugin = (expr) => s.evaluate(`window.PLUGIN_LIST['${PLUGIN}'].${expr}`);

if ((await s.evaluate(`SteamClient.UI.GetUIMode?.()`)) !== 4) {
    console.log('SKIP  Big Picture is not open');
    s.close();
    process.exit(0);
}

const spec = arg('theme', null);
const source = arg('source', 'arrival');
const pattern = arg('pattern', 'one');
const ms = Number(arg('ms', pattern === 'one' ? 9000 : pattern === 'mixed' || pattern === 'queue' ? 2000 : 18000));
let themePath = null;
const previousTheme = await plugin(`activeTheme()?.name`);

async function useTheme(name) {
    await plugin(`setSetting('theme', '${name}')`);
    for (let i = 0; i < 40 && (await plugin('activeTheme()?.name')) !== name; i++) await wait(100);
}

if (spec) {
    const [position, animation] = spec.split(':');
    const userDir = JSON.parse(await s.evaluate(`window.Millennium.callServerMethod('${PLUGIN}', 'ListThemes', { payload: '{}' })`)).userDir;
    themePath = `${userDir}/en_bp_trace.json`;
    const settings = { position };
    if (animation) settings.animation = animation;
    writeFileSync(themePath, JSON.stringify({ settings, popup: { background: ['#202040'], margin: [20, 30] } }));
    if (pattern !== 'first') await useTheme('en_bp_trace');
}

await plugin(`debugBigPicture({ enabled: true, typeSource: '${source === 'pop' ? 'manual' : source}' })`);
await plugin('bigPictureTrace(true)');
const installed = await s.evaluate(`(() => {
    const log = (window.__bpTrace = []);
    const t0 = (window.__bpT0 = performance.now());
    const at = () => Math.round(performance.now() - t0);
    let main = null, popupObj = null;
    for (const p of g_PopupManager.GetPopups()) {
        const el = p.window?.document?.querySelector('[class*="GamepadToastPlaceholder"]');
        if (!el) continue;
        const k = Object.keys(el).find((x) => x.startsWith('__reactFiber'));
        for (let f = el[k], d = 0; f && d < 4 && !popupObj; f = f.return, d++)
            for (let h = f.memoizedState, i = 0; h && i < 16; h = h.next, i++) if (h.memoizedState?.GetBrowserView) { popupObj = h.memoizedState; break; }
        main = p.window;
        break;
    }
    if (!main || !popupObj) return 'no placeholder / popup object';
    const bv = popupObj.GetBrowserView();
    const view = popupObj.GetViewWindow();
    const undo = [];
    for (const m of ['SetBounds', 'SetVisible']) {
        const orig = bv[m];
        const own = Object.prototype.hasOwnProperty.call(bv, m);
        bv[m] = function (...a) { log.push({ t: at(), ev: m, a, stack: m === 'SetBounds' ? (new Error().stack || '').split('\\n').slice(2, 5).map((x) => x.trim()).join(' | ') : undefined }); return orig.apply(this, a); };
        undo.push(() => { if (own) bv[m] = orig; else delete bv[m]; });
    }
    if (${JSON.stringify(source)} === 'pop') {
        const ns = NotificationStore;
        const orig = ns.PopNextToastNotification;
        ns.PopNextToastNotification = function (...a) {
            const n = orig.apply(this, a);
            if (n) { log.push({ t: at(), ev: 'pop', ctx: a[0], eType: n.eType, id: n.notificationID }); window.PLUGIN_LIST['${PLUGIN}'].debugBigPictureType(n.eType); }
            return n;
        };
        undo.push(() => { delete ns.PopNextToastNotification; });
    }
    const store = NotificationStore.CurrentToastSubscribableValue;
    const sub = store.Subscribe((n) => log.push({ t: at(), ev: 'currentToast', eType: n?.eType ?? null, id: n?.notificationID ?? null }));
    undo.push(() => sub.Unsubscribe());
    let last = {};
    const snap = () => {
        const doc = main.document;
        const el = doc.querySelector('[class*="GamepadToastPlaceholder"]');
        const r = el?.getBoundingClientRect();
        const st = doc.getElementById('enhanced-notifications-placement');
        const tpl = view?.document?.querySelector('[class*="GamepadToastPopup"] > *');
        const cs = tpl && view.getComputedStyle(tpl);
        const cur = {
            ph: el ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), main.getComputedStyle(el).display].join(',') : null,
            phClass: el?.className.split(' ').filter((c) => !c.startsWith('_')).join(' '),
            phStyle: el?.getAttribute('style'),
            style: st ? st.textContent.replace(/\\s+/g, ' ').slice(0, 160) : null,
            view: view ? [view.screenX - main.screenX, view.screenY - main.screenY, view.innerWidth, view.innerHeight].join(',') : null,
            type: view?.document?.body?.getAttribute('data-en-type'),
            tpl: tpl ? tpl.className.split(' ').filter((c) => !c.startsWith('_')).join(' ') + '#' + (tpl.__bpId ||= Math.random().toString(36).slice(2, 6)) : null,
            anim: cs ? cs.animationName : null,
        };
        for (const key of Object.keys(cur)) if (cur[key] !== last[key]) log.push({ t: at(), ev: 'frame', key, v: cur[key] });
        // opacity changes every frame of an animation: log it only at coarse steps
        const op = cs ? Math.round(Number(cs.opacity) * 4) / 4 : null;
        if (op !== last.op) log.push({ t: at(), ev: 'frame', key: 'opacity', v: op });
        cur.op = op;
        last = cur;
    };
    // A timer, not the Big Picture window's rAF: that one stops while the window is not in front (seen live 2026-10-01).
    const timer = setInterval(() => { try { snap(); } catch (e) { log.push({ t: at(), ev: 'snapError', v: String(e) }); } }, 8);
    undo.push(() => clearInterval(timer));
    const onVis = () => log.push({ t: at(), ev: 'visibility', v: main.document.visibilityState });
    main.document.addEventListener('visibilitychange', onVis);
    undo.push(() => main.document.removeEventListener('visibilitychange', onVis));
    log.push({ t: at(), ev: 'visibility', v: main.document.visibilityState });
    window.__bpAt = at;
    window.__bpTraceStop = () => { for (const u of undo.reverse()) try { u(); } catch {} };
    return 'ok';
})()`);
if (installed !== 'ok') {
    console.log(`FAIL  ${installed}`);
    s.close();
    process.exit(1);
}

const toast = () => s.evaluate(`(NotificationStore.TestDownloadComplete(435150), true)`);
const mark = (label) => s.evaluate(`(window.__bpTrace.push({ t: window.__bpAt(), ev: 'mark', v: ${JSON.stringify(label)} }), true)`);
try {
    if (pattern === 'first') {
        await useTheme('en_bp_trace');
        await mark('theme switched, firing at once');
        await toast();
    } else if (pattern === 'burst') {
        await toast();
        await wait(150);
        await toast();
        await wait(150);
        await toast();
    } else if (pattern === 'theme-switch') {
        await toast();
        await wait(1500);
        await mark('switching theme mid-toast');
        await useTheme(previousTheme ?? 'default');
        await wait(6000);
        await mark('second toast');
        await toast();
    } else if (pattern === 'fresh') {
        await s.evaluate(`(() => { for (const p of g_PopupManager.GetPopups()) p.window?.document?.getElementById('enhanced-notifications-placement')?.remove(); return true; })()`);
        await mark('placement style removed');
        await wait(300);
        await toast();
    } else if (pattern === 'queue') {
        for (const [first, second] of [['TestDownloadComplete(435150)', 'TestAchievement(435150)'], ['TestAchievement(435150)', 'TestDownloadComplete(435150)']]) {
            await mark(first);
            await s.evaluate(`(NotificationStore.${first}, true)`);
            await wait(2000);
            await mark(`${second} (queued)`);
            await s.evaluate(`(NotificationStore.${second}, true)`);
            await wait(13000);
        }
    } else if (pattern === 'mixed') {
        for (const call of ['TestLowBatteryNotification()', 'TestDownloadComplete(435150)', 'TestAchievement(435150)']) {
            await mark(call);
            await s.evaluate(`(NotificationStore.${call}, true)`);
            await wait(7000);
        }
    } else {
        await toast();
    }
    await wait(ms);
} finally {
    const log = JSON.parse(await s.evaluate(`JSON.stringify(window.__bpTrace)`));
    await s.evaluate(`(window.__bpTraceStop?.(), true)`);
    const t0 = await s.evaluate('window.__bpT0');
    const own = (await plugin('bigPictureTrace(true)')) ?? [];
    await plugin(`debugBigPicture({ enabled: false, typeSource: 'arrival' })`);
    for (const e of own) log.push({ ...e, t: Math.round(e.t - t0), ev: `plugin:${e.ev}` });
    log.sort((a, b) => a.t - b.t);
    if (log.some((e) => e.ev === 'visibility' && e.v === 'hidden')) console.log('WARN  Big Picture was not in front: animations do not start in a hidden window');
    for (const e of log) console.log(JSON.stringify(e));
    if (themePath) {
        await useTheme(previousTheme ?? 'default');
        rmSync(themePath, { force: true });
    }
    s.close();
}
