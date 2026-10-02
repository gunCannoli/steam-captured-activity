// Live test: the notifications queue (`queue.enabled`, surfaces/queue). Fires three of Steam's test toasts at once and
// counts the desktop toast windows open at the same time: up to 3 with the queue off (Steam's stack), never more than
// 1 with it on (Steam's own `displayToastAlone` on every type). Then the `queue` kill switch puts Steam's values back.
// Settings are restored at the end. Desktop only: Big Picture shows one toast at a time anyway.
//
//   node tests/notifications-queue.mjs
import { connect, resolvePluginName } from './cdp.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = await connect();
const PLUGIN = await resolvePluginName(cdp, 'EN_PLUGIN', 'enhanced-notifications');
const plugin = (expr) => cdp.evaluate(`window.PLUGIN_LIST['${PLUGIN}'].${expr}`);
const stored = () => cdp.evaluate(`window.MILLENNIUM_API.ffi('core', 'PluginConfig_GetAll')('${PLUGIN}')`);
let failed = false;
const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failed = true;
};
const toastWindows = async () =>
    (await (await fetch('http://127.0.0.1:8080/json')).json()).filter((t) => /^notificationtoasts_\d+_desktop$/.test(t.title)).length;

/** Every type's displayToastAlone, read through a stand-in call (plays nothing). */
const aloneFlags = () =>
    cdp.evaluate(`(() => {
        const proto = Object.getPrototypeOf(window.NotificationStore);
        const out = {};
        for (let e = 1; e <= 90; e++) { let c; try { proto.PlayNotificationSound.call({ ChooseSound(x) { c = x; return null; } }, { eType: e }); } catch {} if (c) out[e] = c.displayToastAlone === true; }
        return JSON.stringify(out);
    })()`).then(JSON.parse);

const toastTitles = async () =>
    (await (await fetch('http://127.0.0.1:8080/json')).json()).filter((t) => /^notificationtoasts_\d+_desktop$/.test(t.title)).map((t) => t.title);
const pending = () => cdp.evaluate('window.NotificationStore.m_rgNotificationToasts.length');

/** Three toasts at once: the most desktop toast windows open together, how many toasts showed, and what is left waiting. */
async function burst() {
    for (let t = 0; t < 20000 && (await toastWindows()) > 0; t += 500) await wait(500);
    // What Steam did with the three toasts right away (queued, or already on screen), for a failure report.
    const entered = await cdp.evaluate(`(() => { const s = window.NotificationStore; const before = s.m_rgNotificationToasts.length; s.TestDownloadComplete(435150); s.TestCloudSyncFailure(435150); s.TestLowBatteryNotification(); return JSON.stringify({ before, after: s.m_rgNotificationToasts.length, rendering: s.m_setContextsRenderingToasts?.size ?? null, mode: SteamClient.UI.GetUIMode?.() ?? null }); })()`);
    let max = 0;
    const shown = new Set();
    for (let t = 0; t < 45000; t += 250) {
        const open = await toastTitles();
        open.forEach((x) => shown.add(x));
        max = Math.max(max, open.length);
        if (t > 3000 && open.length === 0 && (await pending()) === 0) break;
        await wait(250);
    }
    return { max, shown: shown.size, left: await pending(), entered: JSON.parse(entered) };
}

const snapshot = (await stored()) ?? {};
try {
    if ((await cdp.evaluate('SteamClient.UI.GetUIMode?.()')) === 4) {
        console.log('SKIP  desktop only (Big Picture is open)');
    } else {
        await plugin(`setSetting('disabledFeatures', '')`);
        // Steam's own display time (5 s + 300 ms in and out) outlasts the stack's 5 s fullscreen cache: without the
        // watchdog (steam/toast-stack.ts) the second toast of a queued burst never showed.
        await plugin(`setSetting('theme', '<steam>')`);
        await wait(500);
        const status = JSON.parse(await plugin('surfaceStatus()').then((s) => JSON.stringify(s)));
        check('queue surface installed', status.some((s) => s.id === 'queue' && s.installed), JSON.stringify(status.find((s) => s.id === 'queue')));

        await plugin(`setSetting('queue.enabled', false)`);
        await wait(300);
        const stock = await aloneFlags();
        const stockRun = await burst();
        check('queue off: Steam stacks the three toasts', stockRun.max >= 2 && stockRun.shown === 3, JSON.stringify(stockRun));

        await plugin(`setSetting('queue.enabled', true)`);
        await wait(300);
        const on = await aloneFlags();
        check('queue on: every type is displayToastAlone', Object.values(on).every(Boolean), `${Object.values(on).filter(Boolean).length}/${Object.keys(on).length}`);
        const queued = await burst();
        check('queue on: one toast at a time', queued.max === 1, JSON.stringify(queued));
        check('queue on: all three show, none left waiting (the stack never stalls)', queued.shown === 3 && queued.left === 0, JSON.stringify(queued));

        await plugin(`setSetting('disabledFeatures', 'queue')`);
        await wait(300);
        check('switched off: Steam\'s own displayToastAlone comes back', JSON.stringify(await aloneFlags()) === JSON.stringify(stock));
        await plugin(`setSetting('disabledFeatures', '')`);
        await wait(300);
        check('switched on again with the queue on: every type alone again', Object.values(await aloneFlags()).every(Boolean));
    }
} finally {
    await plugin('resetSettings()');
    for (const [key, value] of Object.entries(snapshot)) await plugin(`setSetting(${JSON.stringify(key)}, ${JSON.stringify(value)})`);
    const after = (await stored()) ?? {};
    check('settings restored', JSON.stringify(after) === JSON.stringify(snapshot), `${JSON.stringify(snapshot)} -> ${JSON.stringify(after)}`);
    cdp.close();
}
process.exitCode = failed ? 1 : 0;
