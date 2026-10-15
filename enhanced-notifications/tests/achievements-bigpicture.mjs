// Live Big Picture check of the achievement banner. Run with Big Picture open
// (SteamClient.URL.ExecuteSteamURL('steam://open/bigpicture')) and a theme with an `achievements` block selected
// (tests/run-live.mjs selects ps5). Fires Steam's test achievement and asserts the themed banner renders in Big
// Picture's toast window. SCREENSHOT=out.png captures it. Then a download toast queued behind a second banner must
// not restyle it while it shows (the Big Picture flicker). Run it with Big Picture in front: a hidden window does not
// paint, so its animations never start.
// Then Big Picture's one toast place follows the toast on screen (ADR-0050): with a temporary theme, an achievement
// goes to the `achievements` block's corner, the next download to the theme's corner, and, with no `achievements`
// block, an achievement to the theme's corner too.
import { rmSync, writeFileSync } from 'node:fs';
import { connect, resolvePluginName } from './cdp.mjs';

const cdp = await connect();
let failed = false;
try {
    // Start from a settled state: the theme's banner loaded (a script before may just have restored the theme) and no
    // toast still showing (with the notifications queue on, a banner waits for it). Found 2026-10-15: run right after
    // bigpicture-look.mjs, a single look 1.2 s after the unlock found no banner; alone it passed.
    const PLUGIN_NAME = await resolvePluginName(cdp, 'EN_PLUGIN', 'enhanced-notifications');
    for (let i = 0; i < 40 && !(await cdp.evaluate(`!!window.PLUGIN_LIST['${PLUGIN_NAME}'].achievementTheme()`)); i++) await new Promise((r) => setTimeout(r, 250));
    for (let i = 0; i < 40 && (await cdp.evaluate(`!!document.querySelector('.ea-banner') || (window.NotificationStore.CurrentToastSubscribableValue?.Value ?? null) !== null`).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 250));
    await cdp.evaluate(`window.NotificationStore.TestAchievement(480).then(() => true)`);
    let win;
    let result = { found: false };
    for (let t = 0; t < 8000 && !result.found; t += 400) {
        await new Promise((r) => setTimeout(r, 400));
        const targets = await (await fetch('http://127.0.0.1:8080/json')).json();
        for (const toast of targets.filter((x) => /^notificationtoasts_uid/i.test(x.title))) {
            try {
                win?.close();
                win = await connect(toast.title, { timeoutMs: 3000 });
                result = JSON.parse(
                    await win.evaluate(`JSON.stringify((() => {
                        const b = document.querySelector('.ea-banner:not(.ea-waiting)');
                        if (!b) return { found: false };
                        const r = b.getBoundingClientRect(), p = b.parentElement.getBoundingClientRect();
                        return { found: true, classes: b.className, banner: [Math.round(r.width), Math.round(r.height)], frame: [Math.round(p.width), Math.round(p.height)], focused: document.activeElement?.closest?.('.ea-banner') ? 'banner' : document.activeElement?.tagName };
                    })())`, 3000),
                );
                if (result.found) break;
            } catch {
                /* a toast view closing while read */
            }
        }
    }
    if (!win) throw new Error('No Big Picture toast window; is Big Picture open?');
    console.log(`${result.found ? 'PASS' : 'FAIL'}  themed banner in Big Picture toast  ${JSON.stringify(result)}`);
    if (!result.found) failed = true;
    if (result.found && result.focused === 'banner') {
        console.log('FAIL  banner took focus (would steal controller focus)');
        failed = true;
    }
    if (process.env.SCREENSHOT) await win.screenshot(process.env.SCREENSHOT);

    // Big Picture times the toast itself (no popup hold there), so Steam's
    // duration must cover the whole banner: the exit animation has to finish
    // (opacity ~0) before Steam removes the banner, never be cut mid-way. The banner
    // must also have been visible (opacity ~1) at some point: a banner stuck at
    // opacity 0 (the first toast after Big Picture opens, when its toast window's
    // animation clock had not started) would otherwise pass this check unseen.
    if (result.found) {
        let last = null;
        let max = 0;
        for (let t = 0; t < 30_000; t += 100) {
            const s = await win.evaluate(`(() => { const b = document.querySelector('.ea-banner'); return b ? Number(getComputedStyle(b).opacity) : null; })()`);
            if (s === null) break;
            last = s;
            if (s > max) max = s;
            await new Promise((r) => setTimeout(r, 100));
        }
        const ok = last !== null && last < 0.1 && max > 0.9;
        console.log(`${ok ? 'PASS' : 'FAIL'}  exit animation finished before Steam removed the banner  (last opacity ${last}, max opacity ${max})`);
        if (!ok) failed = true;

        // A queued toast must not restyle the banner on screen: until the banner is done, its animation stays the
        // banner's and its window carries no notification type.
        await cdp.evaluate(`window.NotificationStore.TestAchievement(480).then(() => true)`);
        await new Promise((r) => setTimeout(r, 1500));
        await cdp.evaluate(`(window.NotificationStore.TestDownloadComplete(435150), true)`);
        const states = [];
        for (let t = 0; t < 8_000; t += 50) {
            const s = await win.evaluate(`(() => { const b = document.querySelector('.ea-banner:not(.ea-done)'); return b ? (document.body.getAttribute('data-en-type') ?? '-') + ' | ' + getComputedStyle(b).animationName : null; })()`);
            if (s === null && states.length) break;
            if (s !== null && states[states.length - 1] !== s) states.push(s);
            await new Promise((r) => setTimeout(r, 50));
        }
        const kept = states.length === 1 && states[0].startsWith('- | ea-');
        console.log(`${kept ? 'PASS' : 'FAIL'}  a queued toast does not restyle the banner on screen  ${JSON.stringify(states)}`);
        if (!kept) failed = true;
        await new Promise((r) => setTimeout(r, 7000)); // let the queued download finish
    }
    win.close();

    await achievementPosition();
} finally {
    cdp.close();
}
process.exitCode = failed ? 1 : 0;

/** Fire one toast; return the first place Steam sends Big Picture's toast view ([x, y] in the window, and its size), after the view is idle again. */
async function placeOf(fire) {
    return JSON.parse(
        await cdp.evaluate(`(async () => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const find = () => {
                for (const p of g_PopupManager.GetPopups()) {
                    const el = p.window?.document?.querySelector('.GamepadToastPlaceholder');
                    if (!el) continue;
                    const k = Object.keys(el).find((x) => x.startsWith('__reactFiber'));
                    for (let f = el[k], d = 0; f && d < 4; f = f.return, d++)
                        for (let h = f.memoizedState, i = 0; h && i < 16; h = h.next, i++) if (h.memoizedState?.GetBrowserView) return { win: p.window, ph: el, bv: h.memoizedState.GetBrowserView() };
                }
                return null;
            };
            const t = find();
            if (!t) return 'null';
            const busy = () => (NotificationStore.m_rgNotificationToasts?.length ?? 0) > 0 || t.win.getComputedStyle(t.ph).display !== 'none';
            for (let i = 0; i < 60 && busy(); i++) await sleep(500);
            let first = null;
            const own = Object.prototype.hasOwnProperty.call(t.bv, 'SetBounds'), orig = t.bv.SetBounds;
            t.bv.SetBounds = function (x, y, w, h) { if (w > 0 && !first) first = [Math.round(x), Math.round(y)]; return orig.apply(this, arguments); };
            await (${fire});
            for (let i = 0; i < 20 && !first; i++) await sleep(250);
            if (own) t.bv.SetBounds = orig; else delete t.bv.SetBounds;
            for (let i = 0; i < 60 && busy(); i++) await sleep(500);
            return JSON.stringify({ at: first, w: t.win.innerWidth, h: t.win.innerHeight });
        })()`),
    );
}

async function achievementPosition() {
    const PLUGIN = await resolvePluginName(cdp, 'EN_PLUGIN', 'enhanced-notifications');
    const plugin = (expr) => cdp.evaluate(`window.PLUGIN_LIST['${PLUGIN}'].${expr}`);
    const top = (p) => p.startsWith('top_');
    const quadrant = (r, pos) => !!r?.at && (top(pos) ? r.at[1] < r.h / 2 : r.at[1] > r.h / 2) && (pos.endsWith('_left') ? r.at[0] < r.w / 2 : pos.endsWith('_right') ? r.at[0] > r.w / 2 : true);
    const userDir = JSON.parse(await cdp.evaluate(`window.Millennium.callServerMethod('${PLUGIN}', 'ListThemes', { payload: '{}' })`)).userDir;
    const themePos = 'top_left';
    const bannerPos = 'bottom_right';
    const banner = `${userDir}/en_bp_achievements.json`;
    const plain = `${userDir}/en_bp_plain.json`;
    writeFileSync(banner, JSON.stringify({ settings: { position: bannerPos }, popup: { margin: [20, 30] }, achievements: { normal: { margin: 10 } } }));
    writeFileSync(plain, JSON.stringify({ settings: { position: themePos }, popup: { margin: [20, 30] } }));
    const before = await plugin('activeTheme()?.name');
    const select = async (name) => {
        await plugin(`setSetting('theme', '${name}')`);
        for (let i = 0; i < 40 && (await plugin('activeTheme()?.name')) !== name; i++) await new Promise((r) => setTimeout(r, 250));
    };
    try {
        const achievement = `NotificationStore.TestAchievement(480)`;
        const download = `(NotificationStore.TestDownloadComplete(435150), 0)`;

        await select('en_bp_achievements');
        const ach = await placeOf(achievement);
        const okAch = quadrant(ach, bannerPos);
        console.log(`${okAch ? 'PASS' : 'FAIL'}  an achievement banner goes to its theme's corner (${bannerPos})  ${JSON.stringify(ach)}`);
        if (!okAch) failed = true;
        const next = await placeOf(download);
        const okNext = quadrant(next, bannerPos);
        console.log(`${okNext ? 'PASS' : 'FAIL'}  the next download goes to the same corner (${bannerPos}), with the popup's margin  ${JSON.stringify(next)}`);
        if (!okNext) failed = true;

        await select('en_bp_plain');
        const same = await placeOf(achievement);
        const okSame = quadrant(same, themePos);
        console.log(`${okSame ? 'PASS' : 'FAIL'}  without an achievements block, an achievement goes to the theme's corner (${themePos})  ${JSON.stringify(same)}`);
        if (!okSame) failed = true;
    } finally {
        await plugin(before ? `setSetting('theme', ${JSON.stringify(before)})` : 'resetSettings()');
        rmSync(banner, { force: true });
        rmSync(plain, { force: true });
    }
}
