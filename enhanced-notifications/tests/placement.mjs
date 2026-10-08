// Live test: theme position, margin, padding, gap and animation on desktop toasts, using a temporary theme written to
// the user themes folder (deleted afterwards). Fires two stacked toasts, checks where each popup sits (Steam's
// stacking kept, from the theme's corner), the padding and gap Steam's toast parts compute, the entrance/exit
// animations, and that the `placement` kill switch hands placement back to Steam. Desktop only: skips in Big Picture.
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
const stored = () => cdp.evaluate(`window.MILLENNIUM_API.ffi('core', 'PluginConfig_GetAll')('${PLUGIN}')`);
// The user's own stored settings, restored exactly at the end (never wiped).
const before_ = (await stored()) ?? {};
/** Put back exactly what was stored before the test; true when the stored settings match it again. */
async function restoreSettings() {
    await plugin('resetSettings()');
    for (const [key, value] of Object.entries(before_)) await plugin(`setSetting(${JSON.stringify(key)}, ${JSON.stringify(value)})`);
    const left = (await stored()) ?? {};
    const sorted = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
    return { ok: sorted(left) === sorted(before_), detail: `${JSON.stringify(before_)} -> ${JSON.stringify(left)}` };
}
const toastTargets = async () =>
    (await (await fetch('http://127.0.0.1:8080/json')).json()).filter((t) => /^notificationtoasts_\d+_desktop$/.test(t.title));

/** Fire `count` download toasts 200 ms apart, wait `ms`, then read every desktop toast window. */
async function fire(count, ms) {
    for (let i = 0; i < count; i++) {
        await cdp.evaluate(`(NotificationStore.TestDownloadComplete(${i ? 570 : 435150}), true)`);
        if (i < count - 1) await wait(200);
    }
    await wait(ms);
    const out = [];
    for (const t of await toastTargets()) {
        const w = await connect(t.title);
        try {
            out.push(
                JSON.parse(
                    await w.evaluate(`JSON.stringify((() => {
                        const q = (k) => document.querySelector('[class*="' + k + '"]');
                        const tpl = q('DesktopToastTemplate'), content = tpl?.querySelector('[class*="Content"]');
                        const wrap = q('DesktopToastPopup')?.parentElement;
                        return {
                            name: window.name, x: window.screenX, y: window.screenY,
                            availLeft: screen.availLeft, availTop: screen.availTop,
                            type: document.body.getAttribute('data-en-type'),
                            displayMs: document.body.style.getPropertyValue('--en-display-ms'),
                            padding: tpl && getComputedStyle(tpl).padding,
                            gapX: content && getComputedStyle(content).marginLeft,
                            gapY: content && getComputedStyle(content).rowGap,
                            animations: wrap ? wrap.getAnimations().map((a) => a.animationName) : [],
                        };
                    })())`),
                ),
            );
        } finally {
            w.close();
        }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

if ((await cdp.evaluate(`SteamClient.UI.GetUIMode?.()`)) === 4) {
    console.log('SKIP  desktop only: Big Picture is open (tests/bigpicture.mjs covers it)');
    cdp.close();
    process.exit(0);
}
const userDir = JSON.parse(await cdp.evaluate(`window.Millennium.callServerMethod('${PLUGIN}', 'ListThemes', { payload: '{}' })`)).userDir;
const themePath = `${userDir}/en_place_test.jsonc`;
writeFileSync(
    themePath,
    `// temporary: tests/placement.mjs
    {
        "settings": { "position": "top_left", "animation": "ps5" },
        "popup": { "background": ["#101010"], "margin": [20, 30], "padding": [12, 6, 3, 9], "gap": [20, 4] },
    }`,
);

try {
    await plugin(`setSetting('disabledFeatures', '')`);
    await plugin(`setSetting('queue.enabled', false)`); // two toasts must stack: the notifications queue would show one at a time
    await plugin(`setSetting('theme', 'en_place_test')`);
    for (let i = 0; i < 40 && (await plugin('activeTheme()?.name')) !== 'en_place_test'; i++) await wait(250);
    check('temp theme loaded', (await plugin('activeTheme()?.name')) === 'en_place_test');

    const [older, newer] = await fire(2, 1500);
    check('two desktop toast windows', !!older && !!newer, `${(await toastTargets()).length} open`);
    if (older && newer) {
        const x0 = newer.availLeft + 30;
        const y0 = newer.availTop + 20;
        check('newest toast at the theme corner plus margin', Math.abs(newer.x - x0) <= 2 && Math.abs(newer.y - y0) <= 2, `at ${newer.x},${newer.y}, want ${x0},${y0}`);
        check("older toast one slot inward (Steam's stacking kept)", Math.abs(older.x - x0) <= 2 && older.y - newer.y >= 60 && older.y - newer.y <= 80, `at ${older.x},${older.y}`);
        check('each window carries its own type and display time', newer.type === 'DownloadComplete' && /^\d+ms$/.test(newer.displayMs), `${newer.type} ${newer.displayMs}`);
        check('padding [12, 6, 3, 9] on the toast template', newer.padding === '12px 6px 3px 9px', newer.padding);
        check('gap [20, 4]: logo to text, between rows', newer.gapX === '20px' && newer.gapY === '4px', `${newer.gapX} / ${newer.gapY}`);
        check('ps5 entrance and exit from the left', newer.animations.join() === 'en-in-ps5-left,en-out-ps5-left', newer.animations.join());
    }
    await wait(7000); // let both toasts close

    await plugin(`setSetting('disabledFeatures', 'placement')`);
    await wait(300);
    const [stock] = await fire(1, 1500);
    check('placement off: Steam places the toast', !!stock && !(Math.abs(stock.x - (stock.availLeft + 30)) <= 2 && Math.abs(stock.y - (stock.availTop + 20)) <= 2), stock && `at ${stock.x},${stock.y}`);
    check('placement off: still styled', stock?.padding === '12px 6px 3px 9px', stock?.padding);
    await wait(6000);
} finally {
    const restored = await restoreSettings();
    rmSync(themePath, { force: true });
    if (!restored.ok) failed = true;
    console.log(`${failed ? 'FAIL' : 'PASS'}  settings restored, temp theme removed${restored.ok ? '' : `  (${restored.detail})`}`);
    cdp.close();
}
process.exit(failed ? 1 : 0);
