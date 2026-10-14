// Live, Big Picture only (SKIP otherwise): a theme's own Big Picture look (ADR-0068, the `bigpicture` block).
// A temporary theme with one desktop background and corner and another for Big Picture (deleted afterwards): in Big
// Picture the plugin's current look is the Big Picture one, Big Picture's toast view gets the Big Picture CSS (never the
// desktop colour), and its placement follows the Big Picture corner.
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

const DESKTOP = '#102030';
const BP = '#aa2233';
const NAME = 'en_bp_look';
const userDir = await cdp.evaluate(
    `window.Millennium.callServerMethod('${PLUGIN}', 'ListThemes', { payload: '{}' }).then((r) => JSON.parse(r).userDir)`,
);
const file = `${userDir}\\${NAME}.jsonc`;
const before = await plugin(`allSettings().theme`);
writeFileSync(
    file,
    JSON.stringify({
        settings: { position: 'top_left' },
        popup: { background: [DESKTOP] },
        bigpicture: { settings: { position: 'top_center' }, popup: { background: [BP] } },
    }),
);
try {
    await plugin(`setSetting('theme', '${NAME}')`);
    for (let i = 0; i < 20 && (await plugin(`activeTheme('desktop')?.name ?? null`)) !== NAME; i++) await wait(250);
    check('the theme loaded', (await plugin(`activeTheme('desktop')?.name ?? null`)) === NAME);
    const bpCss = await plugin(`themeCss('bigpicture')`);
    check('its Big Picture CSS has the Big Picture colour, not the desktop one', bpCss.includes(BP) && !bpCss.includes(DESKTOP));
    check('in Big Picture the current look is the Big Picture one', (await plugin(`themeCss()`)) === bpCss);
    check('the desktop look keeps its own colour', (await plugin(`themeCss('desktop')`)).includes(DESKTOP));

    await plugin(`preview('DownloadComplete')`);
    await wait(1500);
    const targets = await (await fetch('http://127.0.0.1:8080/json')).json();
    const view = targets.find((t) => /^notificationtoasts_uid/.test(t.title));
    check('Big Picture toast view found', !!view, targets.map((t) => t.title).filter((t) => /toast/i.test(t)).join(', '));
    if (view) {
        const win = await connect(view.title);
        const css = await win.evaluate(`document.getElementById('enhanced-notifications-theme')?.textContent ?? ''`);
        check('the toast view has the Big Picture CSS', css.includes(BP) && !css.includes(DESKTOP));
        win.close();
    }
    const placement = await cdp.evaluate(`(() => {
        for (const p of window.g_PopupManager?.GetPopups?.() ?? []) {
            const el = p.window?.document?.getElementById('enhanced-notifications-placement');
            if (el) return el.textContent;
        }
        return '';
    })()`);
    check('the placement follows the Big Picture corner (top centre)', /top: 0px/.test(placement) && /margin-left: auto/.test(placement), placement.trim());
} finally {
    await plugin(`setSetting('theme', ${JSON.stringify(before)})`);
    await wait(500);
    rmSync(file, { force: true });
    console.log('PASS  settings restored, temp theme removed');
}
cdp.close();
process.exit(failed ? 1 : 0);
