// Debug probe: how Steam places desktop toast popups. Records, per popup:
// creation time, every MoveTo (x, y) Steam sends, window size, and when the
// popup's own notification (eType) becomes readable from its DOM fiber.
// Fires two toasts back to back to see stacking. Usage: node tests/probes/toast-placement.mjs
import { connect } from '../cdp.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const s = await connect();
await s.evaluate(`(() => {
    const log = (window.__placeLog = []);
    const t0 = performance.now();
    const at = () => Math.round(performance.now() - t0);
    const typeOf = (win) => {
        for (const el of win.document?.querySelectorAll('*') ?? []) {
            const fk = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
            for (let f = fk && el[fk], i = 0; f && i < 40; f = f.return, i++) {
                const n = f.memoizedProps?.notification;
                if (n && typeof n.eType === 'number') return n.eType;
            }
        }
        return null;
    };
    if (!window.__placeHooked) {
        window.__placeHooked = true;
        Millennium.AddWindowCreateHook((p) => window.__placeOn?.(p));
    }
    window.__placeOn = (p) => {
        const win = p?.window;
        if (!win || !/notificationtoasts/i.test(p.m_strName ?? '')) return;
        const api = win.SteamClient?.Window;
        const own = api && Object.getOwnPropertyDescriptor(api, 'MoveTo');
        log.push({ t: at(), ev: 'create', name: p.m_strName, w: win.innerWidth, h: win.innerHeight, avail: [win.screen.availLeft, win.screen.availTop, win.screen.availWidth, win.screen.availHeight], ownMoveTo: !!own, eType: typeOf(win) });
        if (api && typeof api.MoveTo === 'function') {
            const o = api.MoveTo; let n = 0;
            api.MoveTo = function (x, y, d) { if (n++ < 40) log.push({ t: at(), ev: 'move', name: p.m_strName, x, y, d, eType: typeOf(win) }); return o.apply(this, arguments); };
        }
    };
    NotificationStore.TestDownloadComplete(435150);
    setTimeout(() => NotificationStore.TestDownloadComplete(570), 150);
    return true;
})()`);
await wait(16000);
const log = JSON.parse(await s.evaluate(`JSON.stringify(window.__placeLog)`));
await s.evaluate(`(window.__placeOn = null, true)`);
for (const e of log) console.log(JSON.stringify(e));
s.close();
