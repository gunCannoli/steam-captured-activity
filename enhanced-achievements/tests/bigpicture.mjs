// Live Big Picture check. Run with Big Picture open
// (SteamClient.URL.ExecuteSteamURL('steam://open/bigpicture')).
// Fires Steam's test achievement and asserts the themed banner renders in Big
// Picture's toast window. SCREENSHOT=out.png captures it. Then a download toast
// queued behind a second banner must not restyle it while it shows (the Big
// Picture flicker, docs/plans/enhanced-notifications-bigpicture-toast-fix-plan.md;
// meaningful when enhanced-notifications is loaded too). Run it with Big Picture
// in front: a hidden window does not paint, so its animations never start.
// Then the one Big Picture position (ADR-0049), with enhanced-notifications loaded
// (SKIP otherwise): enhanced-notifications' theme corner by default, this theme's
// corner for achievements with "Force achievement position in Big Picture" on,
// and back to enhanced-notifications' corner for the next non-achievement toast.
import { rmSync, writeFileSync } from 'node:fs';
import { connect, resolvePluginName } from './cdp.mjs';

const cdp = await connect();
let failed = false;
try {
    await cdp.evaluate(`window.NotificationStore.TestAchievement(480).then(() => true)`);
    await new Promise((r) => setTimeout(r, 1200));
    const targets = await (await fetch('http://127.0.0.1:8080/json')).json();
    const toast = targets.find((t) => /^notificationtoasts_uid/i.test(t.title));
    if (!toast) throw new Error('No Big Picture toast window; is Big Picture open?');
    const win = await connect(toast.title);
    const result = JSON.parse(
        await win.evaluate(`JSON.stringify((() => {
            const b = document.querySelector('.ea-banner');
            if (!b) return { found: false };
            const r = b.getBoundingClientRect(), p = b.parentElement.getBoundingClientRect();
            return { found: true, classes: b.className, banner: [Math.round(r.width), Math.round(r.height)], frame: [Math.round(p.width), Math.round(p.height)], focused: document.activeElement?.closest?.('.ea-banner') ? 'banner' : document.activeElement?.tagName };
        })())`),
    );
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

        // A queued toast must not restyle the banner on screen: until the banner is done, its animation stays ours
        // and its window carries no enhanced-notifications type.
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

    await forcedPosition();
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

async function forcedPosition() {
    const names = JSON.parse(await cdp.evaluate(`JSON.stringify(Object.keys(window.PLUGIN_LIST || {}))`));
    const EN = ['enhanced-notifications-dev', 'enhanced-notifications'].find((n) => names.includes(n));
    if (!EN) {
        console.log('SKIP  forced Big Picture position: enhanced-notifications is not loaded');
        return;
    }
    const EA = await resolvePluginName(cdp, 'EA_PLUGIN', 'enhanced-achievements');
    const ea = (expr) => cdp.evaluate(`window.PLUGIN_LIST['${EA}'].${expr}`);
    const en = (expr) => cdp.evaluate(`window.PLUGIN_LIST['${EN}'].${expr}`);
    const eaPos = await ea('activeTheme()?.theme?.position');
    if (!eaPos) {
        console.log('SKIP  forced Big Picture position: no enhanced-achievements theme selected');
        return;
    }
    // enhanced-notifications' corner: the opposite of this theme's, so the two can never be confused.
    const enPos = `${eaPos.startsWith('top_') ? 'bottom' : 'top'}_${eaPos.endsWith('_left') ? 'right' : 'left'}`;
    const top = (p) => p.startsWith('top_');
    const quadrant = (r, pos) => !!r?.at && (top(pos) ? r.at[1] < r.h / 2 : r.at[1] > r.h / 2) && (pos.endsWith('_left') ? r.at[0] < r.w / 2 : pos.endsWith('_right') ? r.at[0] > r.w / 2 : true);
    const userDir = JSON.parse(await cdp.evaluate(`window.Millennium.callServerMethod('${EN}', 'ListThemes', { payload: '{}' })`)).userDir;
    const themePath = `${userDir}/ea_force_test.json`;
    const enTheme = await en('activeTheme()?.name');
    const force = await ea(`allSettings()['bigpicture.force_position']`);
    writeFileSync(themePath, JSON.stringify({ settings: { position: enPos }, popup: { margin: [20, 30] } }));
    try {
        await en(`setSetting('theme', 'ea_force_test')`);
        for (let i = 0; i < 40 && (await en('activeTheme()?.name')) !== 'ea_force_test'; i++) await new Promise((r) => setTimeout(r, 250));
        const achievement = `NotificationStore.TestAchievement(480)`;
        const download = `(NotificationStore.TestDownloadComplete(435150), 0)`;

        await ea(`setSetting('bigpicture.force_position', false)`);
        const off = await placeOf(achievement);
        const okOff = quadrant(off, enPos);
        console.log(`${okOff ? 'PASS' : 'FAIL'}  force off: an achievement goes to enhanced-notifications' corner (${enPos})  ${JSON.stringify(off)}`);
        if (!okOff) failed = true;

        await ea(`setSetting('bigpicture.force_position', true)`);
        const on = await placeOf(achievement);
        const okOn = quadrant(on, eaPos);
        console.log(`${okOn ? 'PASS' : 'FAIL'}  force on: an achievement goes to this theme's corner (${eaPos})  ${JSON.stringify(on)}`);
        if (!okOn) failed = true;
        const next = await placeOf(download);
        const okNext = quadrant(next, enPos);
        console.log(`${okNext ? 'PASS' : 'FAIL'}  force on: the next download goes back to enhanced-notifications' corner  ${JSON.stringify(next)}`);
        if (!okNext) failed = true;
    } finally {
        await ea(`setSetting('bigpicture.force_position', ${force === true})`);
        await en(enTheme ? `setSetting('theme', ${JSON.stringify(enTheme)})` : 'resetSettings()');
        rmSync(themePath, { force: true });
    }
}
