// Live test, Big Picture only (SKIP otherwise; open it with SteamClient.URL.ExecuteSteamURL('steam://open/bigpicture')):
// a temporary theme with position, margin, padding and animation (deleted afterwards). Checks that Big Picture's toast
// view moves to the theme corner (it follows the placeholder in the Big Picture window), that the theme animation
// replaces Steam's on the toast template, that the restyle applies, and that the `placement` kill switch gives
// Steam's place back. Then the flicker regressions (git show 9a7df2b:docs/plans/enhanced-notifications-bigpicture-toast-fix-plan.md):
// a toast queued behind the one on screen never restyles it, in both orders (the temporary theme has no
// `achievements` block, so the achievement is styled like every toast; tests/achievements-bigpicture.mjs covers the
// banner), every place Steam sends the view is the theme's, and the placement style is in place before Steam
// measures, even in a window that did not have it yet.
// Run it with Big Picture in front: a hidden window does not paint, so its animations never start.
import { rmSync, writeFileSync } from 'node:fs';
import { connect, resolvePluginName } from './cdp.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = await connect();
const PLUGIN = await resolvePluginName(cdp, 'EN_PLUGIN', 'enhanced-notifications');
let failed = false;
const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failed = true;
};
const plugin = (expr) => cdp.evaluate(`window.PLUGIN_LIST['${PLUGIN}'].${expr}`);

if ((await cdp.evaluate(`SteamClient.UI.GetUIMode?.()`)) !== 4) {
    console.log('SKIP  Big Picture is not open');
    cdp.close();
    process.exit(0);
}

/** Show a download toast and read the Big Picture toast view: where it is, its template's animations and padding. */
async function fire() {
    await cdp.evaluate(`(NotificationStore.TestDownloadComplete(435150), true)`);
    await wait(1200);
    const r = JSON.parse(
        await cdp.evaluate(`JSON.stringify((() => {
            for (const p of g_PopupManager.GetPopups()) {
                const el = p.window?.document?.querySelector('[class*="GamepadToastPlaceholder"]');
                if (!el) continue;
                const k = Object.keys(el).find((x) => x.startsWith('__reactFiber'));
                let view = null;
                for (let f = el[k], d = 0; f && d < 4 && !view; f = f.return, d++)
                    for (let h = f.memoizedState, i = 0; h && i < 16; h = h.next, i++) if (h.memoizedState?.GetViewWindow) { view = h.memoizedState.GetViewWindow(); break; }
                if (!view) return null;
                const tpl = view.document.querySelector('[class*="GamepadToastPopup"] > *');
                return {
                    x: view.screenX - p.window.screenX, y: view.screenY - p.window.screenY,
                    mainW: p.window.innerWidth, mainH: p.window.innerHeight, w: view.innerWidth, h: view.innerHeight,
                    type: view.document.body.getAttribute('data-en-type'),
                    animations: tpl ? view.getComputedStyle(tpl).animationName : null,
                    padding: tpl ? view.getComputedStyle(tpl).padding : null,
                };
            }
            return null;
        })())`),
    );
    await wait(6000);
    return r;
}

/**
 * Fire `first`, then `second` 1.5 s later (queued behind it), and record, for each toast template while the toast
 * is on screen (the placeholder is displayed): `data-en-type | animation-name` each time it changes, and every
 * non-empty SetBounds Steam sends the view. Sampled every 40 ms from SharedJSContext.
 */
async function queued(first, second) {
    return JSON.parse(
        await cdp.evaluate(`(async () => {
            let main = null, ph = null, popup = null;
            for (const p of g_PopupManager.GetPopups()) {
                const el = p.window?.document?.querySelector('[class*="GamepadToastPlaceholder"]');
                if (!el) continue;
                const k = Object.keys(el).find((x) => x.startsWith('__reactFiber'));
                for (let f = el[k], d = 0; f && d < 4 && !popup; f = f.return, d++)
                    for (let h = f.memoizedState, i = 0; h && i < 16; h = h.next, i++) if (h.memoizedState?.GetViewWindow) { popup = h.memoizedState; break; }
                main = p.window; ph = el;
                break;
            }
            if (!popup) return 'null';
            const view = popup.GetViewWindow(), bv = popup.GetBrowserView();
            const bounds = [];
            const own = Object.prototype.hasOwnProperty.call(bv, 'SetBounds'), orig = bv.SetBounds;
            bv.SetBounds = function (x, y, w, h) { if (w > 0) bounds.push([Math.round(x), Math.round(y)]); return orig.apply(this, arguments); };
            const seen = [];
            const timer = setInterval(() => {
                if (main.getComputedStyle(ph).display === 'none') return;
                const el = view.document.querySelector('[class*="GamepadToastPopup"] > *');
                if (!el) return;
                if (!el.__enQueued) seen.push((el.__enQueued = { banner: String(el.className).includes('ea-banner'), states: [] }));
                const state = (view.document.body.getAttribute('data-en-type') ?? '-') + ' | ' + view.getComputedStyle(el).animationName;
                const states = el.__enQueued.states;
                if (states[states.length - 1] !== state) states.push(state);
            }, 40);
            NotificationStore.${first};
            await new Promise((r) => setTimeout(r, 1500));
            NotificationStore.${second};
            await new Promise((r) => setTimeout(r, 13000));
            clearInterval(timer);
            if (own) bv.SetBounds = orig; else delete bv.SetBounds;
            return JSON.stringify({ seen, bounds });
        })()`),
    );
}

/** Each queued run: two toasts seen, each with one state for its whole time on screen, the banner never ours. */
function checkQueued(label, r) {
    check(`${label}: both toasts shown`, r?.seen?.length === 2, JSON.stringify(r?.seen));
    for (const [i, t] of (r?.seen ?? []).entries()) {
        check(`${label}: toast ${i + 1} keeps one style while on screen`, t.states.length === 1, JSON.stringify(t.states));
        if (t.banner) check(`${label}: the achievement banner never gets the notification type or animation`, t.states.every((s) => s.startsWith('- | ') && !/\ben-/.test(s)), JSON.stringify(t.states));
        else check(`${label}: toast ${i + 1} has the theme's animation`, t.states.every((s) => s.endsWith('en-in-fade, en-out-fade')), JSON.stringify(t.states));
    }
    check(`${label}: Steam always sends the view to the theme's place`, (r?.bounds?.length ?? 0) >= 2 && r.bounds.every(([x, y]) => Math.abs(x - 30) <= 2 && Math.abs(y - 20) <= 2), JSON.stringify(r?.bounds));
}

/** Remove our placement style (as in a Big Picture window opened after start-up), fire a toast: Steam's first SetBounds is already the theme's. */
async function fresh() {
    return JSON.parse(
        await cdp.evaluate(`(async () => {
            let bv = null;
            for (const p of g_PopupManager.GetPopups()) {
                const el = p.window?.document?.querySelector('[class*="GamepadToastPlaceholder"]');
                if (!el) continue;
                p.window.document.getElementById('enhanced-notifications-placement')?.remove();
                const k = Object.keys(el).find((x) => x.startsWith('__reactFiber'));
                for (let f = el[k], d = 0; f && d < 4 && !bv; f = f.return, d++)
                    for (let h = f.memoizedState, i = 0; h && i < 16; h = h.next, i++) if (h.memoizedState?.GetBrowserView) { bv = h.memoizedState.GetBrowserView(); break; }
            }
            if (!bv) return 'null';
            const bounds = [];
            const own = Object.prototype.hasOwnProperty.call(bv, 'SetBounds'), orig = bv.SetBounds;
            bv.SetBounds = function (x, y, w, h) { if (w > 0) bounds.push([Math.round(x), Math.round(y)]); return orig.apply(this, arguments); };
            NotificationStore.TestDownloadComplete(435150);
            await new Promise((r) => setTimeout(r, 7000));
            if (own) bv.SetBounds = orig; else delete bv.SetBounds;
            return JSON.stringify(bounds);
        })()`),
    );
}

const userDir = JSON.parse(await cdp.evaluate(`window.Millennium.callServerMethod('${PLUGIN}', 'ListThemes', { payload: '{}' })`)).userDir;
const themePath = `${userDir}/en_bp_test.json`;
writeFileSync(themePath, JSON.stringify({ settings: { position: 'top_left', animation: 'fade' }, popup: { background: ['#101010'], margin: [20, 30], padding: [4, 8] } }));

try {
    const stock = await fire();
    check('Big Picture toast view found', !!stock, JSON.stringify(stock));
    await plugin(`setSetting('disabledFeatures', '')`);
    await plugin(`setSetting('theme', 'en_bp_test')`);
    for (let i = 0; i < 40 && (await plugin('activeTheme()?.name')) !== 'en_bp_test'; i++) await wait(250);
    const themed = await fire();
    check('toast view at the theme corner plus margin', !!themed && Math.abs(themed.x - 30) <= 2 && Math.abs(themed.y - 20) <= 2, JSON.stringify(themed && { x: themed.x, y: themed.y }));
    check('restyled', themed?.type === 'DownloadComplete', themed?.type);
    check("theme animation replaces Steam's", themed?.animations === 'en-in-fade, en-out-fade', themed?.animations);
    check('padding [4, 8] on the toast template', themed?.padding === '4px 8px', themed?.padding);

    checkQueued('achievement queued behind a download', await queued('TestDownloadComplete(435150)', 'TestAchievement(435150)'));
    checkQueued('download queued behind an achievement', await queued('TestAchievement(435150)', 'TestDownloadComplete(435150)'));
    const first = await fresh();
    check('fresh window: placement in place before Steam measures', first?.[0] && Math.abs(first[0][0] - 30) <= 2 && Math.abs(first[0][1] - 20) <= 2, JSON.stringify(first));

    await plugin(`setSetting('disabledFeatures', 'placement')`);
    await wait(300);
    const off = await fire();
    check("placement off: Steam's place", !!off && !!stock && Math.abs(off.x - stock.x) <= 2 && Math.abs(off.y - stock.y) <= 2, JSON.stringify(off && { x: off.x, y: off.y, stock: [stock?.x, stock?.y] }));
} finally {
    await plugin(`resetSettings()`);
    rmSync(themePath, { force: true });
    console.log(`${failed ? 'FAIL' : 'PASS'}  Big Picture: settings reset, temp theme removed`);
    cdp.close();
}
process.exit(failed ? 1 : 0);
