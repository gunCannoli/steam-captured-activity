// Live test, Big Picture only (SKIP otherwise; open it with SteamClient.URL.ExecuteSteamURL('steam://open/bigpicture')):
// a temporary theme with position, margin, padding and animation (deleted afterwards). Checks that Big Picture's toast
// view moves to the theme corner (it follows the placeholder in the Big Picture window), that the theme animation
// replaces Steam's on the toast template, that the restyle applies, and that the `placement` kill switch gives
// Steam's place back.
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
