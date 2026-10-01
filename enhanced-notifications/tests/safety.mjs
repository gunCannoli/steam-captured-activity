// Live test: kill switches (ADR-0047), against a running Steam with enhanced-notifications
// (or -dev) deployed. Restores exactly the settings stored before it ran.
//
//   node tests/safety.mjs            (THEME=<name> to pick the theme; default steam_midnight)
//
// 1. A clean start: not in safe mode, nothing tripped, no errors, all four surfaces installed.
// 2. `disabledFeatures = style`: a download preview toast is Steam's own (no data-en-type).
// 3. Switch cleared: the same preview is restyled again (data-en-type = DownloadComplete).
import { connect, resolvePluginName } from './cdp.mjs';

const THEME = process.env.THEME ?? 'steam_midnight';
const cdp = await connect();
const PLUGIN = await resolvePluginName(cdp, 'EN_PLUGIN', 'enhanced-notifications');
const plugin = (expr) => cdp.evaluate(`window.PLUGIN_LIST[${JSON.stringify(PLUGIN)}].${expr}`);
const stored = () => cdp.evaluate(`window.MILLENNIUM_API.ffi('core', 'PluginConfig_GetAll')(${JSON.stringify(PLUGIN)})`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failed = true;
};

/** The toast window with content, or null after ~12 s (Big Picture's window exists even when idle). */
async function toastWindow() {
    for (let i = 0; i < 24; i++) {
        await wait(500);
        const t = (await (await fetch('http://127.0.0.1:8080/json')).json()).find((x) => /^notificationtoasts/i.test(x.title));
        if (!t) continue;
        const win = await connect(t.title);
        const hasContent = await win.evaluate(`document.body.innerText.trim() !== ''`);
        if (hasContent) return win;
        win.close();
    }
    return null;
}

/** Preview a download toast and read its window's data-en-type (undefined: no toast shown). */
async function previewType() {
    await plugin(`previewCategory('downloads')`);
    const win = await toastWindow();
    if (!win) return undefined;
    await wait(700);
    const type = await win.evaluate(`document.body.getAttribute('data-en-type')`);
    win.close();
    await wait(6500); // let the toast go before the next one
    return type;
}

const before_ = (await stored()) ?? {};
try {
    const diag = await plugin('safetyDiagnostics()');
    check('clean start: not in safe mode', diag?.safeMode === false, JSON.stringify(diag));
    check('clean start: nothing tripped, no errors', diag?.tripped?.length === 0 && Object.keys(diag?.errors ?? {}).length === 0, JSON.stringify(diag));
    const status = await plugin('surfaceStatus()');
    check(
        'clean start: style, sound, duration and preview installed',
        ['style', 'sound', 'duration', 'preview'].every((id) => status?.some((s) => s.id === id && s.installed)),
        JSON.stringify(status),
    );

    await plugin(`setSetting('theme', ${JSON.stringify(THEME)})`);
    for (let i = 0; i < 20 && (await plugin('activeTheme()?.name')) !== THEME; i++) await wait(250);
    check(`theme "${THEME}" loaded`, (await plugin('activeTheme()?.name')) === THEME);

    await plugin(`setSetting('disabledFeatures', 'style')`);
    const stock = await previewType();
    check("style off: the preview is Steam's own toast", stock === null, `data-en-type=${stock}`);

    await plugin(`setSetting('disabledFeatures', '')`);
    const themed = await previewType();
    check('style on again: the preview is restyled', themed === 'DownloadComplete', `data-en-type=${themed}`);

    const after = await plugin('safetyDiagnostics()');
    check('no errors counted during the test', Object.keys(after?.errors ?? {}).length === 0, JSON.stringify(after));
} finally {
    await plugin('resetSettings()');
    for (const [key, value] of Object.entries(before_)) await plugin(`setSetting(${JSON.stringify(key)}, ${JSON.stringify(value)})`);
    const left = (await stored()) ?? {};
    const sorted = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
    check('settings restored to what was stored before the test', sorted(left) === sorted(before_), `${JSON.stringify(before_)} -> ${JSON.stringify(left)}`);
    cdp.close();
}
process.exitCode = failed ? 1 : 0;
