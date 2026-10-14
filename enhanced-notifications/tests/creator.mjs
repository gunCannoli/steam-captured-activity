// Live: the Theme Creator end to end through its own UI (theme creator plan § 10). Needs the desktop window.
//   node tests/creator.mjs
// Opens the creator (the export the settings panel's button calls), starts from the first bundled template, makes a
// Big Picture edit, saves a copy as __creator_test (assets copied into its folder, paths rewritten, bigpicture kept),
// checks the plugin lists it and loads its icons from the user folder, runs Test on screen and checks the active
// theme's CSS is back byte for byte, then deletes the copy through the Start page. Leaves no file behind.
import { existsSync, readFileSync } from 'node:fs';
import { connect, resolvePluginName } from './cdp.mjs';

const NAME = '__creator_test';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failed = true;
};
const titles = async () => (await (await fetch('http://127.0.0.1:8080/json')).json()).map((t) => t.title);
const waitTitle = async (title, present = true) => {
    for (let i = 0; i < 30; i++) {
        if ((await titles()).includes(title) === present) return true;
        await wait(300);
    }
    return false;
};

/** Click the n-th visible element whose own text is `text` (buttons first), in a window. */
async function click(win, text, n = 0) {
    const r = await win.evaluate(`(() => {
        const hits = [...document.querySelectorAll('button, [role=button], .DialogButton, div')]
            .filter((e) => (e.children.length === 0 || e.matches('button, [role=button], .DialogButton')) && e.textContent.trim() === ${JSON.stringify(text)} && e.offsetParent !== null);
        const el = hits[${n}];
        if (!el) return false;
        (el.closest('button, [role=button], .DialogButton') ?? el).click();
        return true;
    })()`);
    await wait(700);
    return r;
}

const shared = await connect();
const P = await resolvePluginName(shared, 'EN_PLUGIN', 'enhanced-notifications');
const plugin = (expr) => shared.evaluate(`window.PLUGIN_LIST['${P}'].${expr}`);
const rpcCall = (name, payload = {}) =>
    shared.evaluate(`window.Millennium.callServerMethod('${P}', '${name}', { payload: JSON.stringify(${JSON.stringify(payload)}) }).then((r) => JSON.parse(r))`);

let userDir = '';
try {
    userDir = (await rpcCall('ListThemes')).userDir;
    if ((await rpcCall('ListThemes')).themes.some((t) => t.name === NAME)) await rpcCall('DeleteTheme', { id: NAME, assets: true });

    if (!(await titles()).includes('Theme Creator')) await plugin('openThemeCreatorForTest()');
    check('the creator opens', await waitTitle('Theme Creator'));
    const win = await connect('Theme Creator');
    await wait(1500);
    const bundled = (await rpcCall('ListThemes')).themes.filter((t) => t.source === 'bundled').map((t) => t.name);
    const listed = await win.evaluate(`[...document.querySelectorAll('div')].filter((e) => e.children.length === 0).map((e) => e.textContent.trim())`);
    check('the Start page lists every bundled template', bundled.every((b) => listed.includes(b)), bundled.join(', '));

    check('a template opens', await click(win, 'Use', 0));
    check('Big Picture mode', await click(win, 'Big Picture'));
    check('a Big Picture key is customized', await click(win, 'Customize', 0));
    await click(win, 'Desktop');

    // The creator's dialogs open over its own window (their parent), not as separate popouts.
    check('Save as opens', (await click(win, 'Save as...')) && (await win.evaluate(`[...document.querySelectorAll('div')].some((e) => e.textContent.trim() === 'Save theme as')`)));
    const dlg = win;
    await dlg.evaluate(`(() => {
        const input = [...document.querySelectorAll('input')].pop();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(NAME)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        let row = [...document.querySelectorAll('div')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Use it now');
        for (let i = 0; i < 6 && row && !row.querySelector('[class*="Toggle"]'); i++) row = row.parentElement;
        const on = row && [...row.querySelectorAll('div')].find((e) => /Toggle/.test(e.className) && /On/.test(e.className));
        if (on) on.click(); // "Use it now" off: the user's active theme stays
        return true;
    })()`);
    await wait(500);
    await click(dlg, 'Save');
    await wait(2000);

    const file = `${userDir}\\${NAME}.jsonc`;
    check('the theme file is written', existsSync(file));
    const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const raw = JSON.parse(text.slice(text.indexOf('\n') + 1) || '{}');
    check('the Big Picture edit is saved under bigpicture', raw.bigpicture && typeof raw.bigpicture === 'object');
    const assetPaths = JSON.stringify(raw).match(/"[^"]+\.(svg|png|wav|mp3)"/g) ?? [];
    check('every asset path points into its own folder', assetPaths.length > 0 && assetPaths.every((p) => p.startsWith(`"${NAME}/`)), assetPaths.slice(0, 3).join(' '));
    const themes = (await rpcCall('ListThemes')).themes.map((t) => t.name);
    check('the plugin lists it', themes.includes(NAME));
    const icons = assetPaths.map((p) => JSON.parse(p)).filter((p) => /\.(svg|png)$/.test(p));
    const urls = icons.length ? await rpcCall('LoadAssets', { dir: userDir, paths: icons }) : {};
    check('its icons load from the user folder', icons.length > 0 && icons.every((p) => typeof urls[p] === 'string'), `${icons.length} icons`);

    const before = await plugin(`themeCss('desktop')`);
    const beforeName = await plugin(`activeTheme('desktop')?.name ?? null`);
    await click(win, 'Test');
    await wait(2500);
    check('Test on screen makes the draft the active theme', (await plugin(`activeTheme('desktop')?.name ?? null`)) === 'Theme Creator test');
    for (let i = 0; i < 60 && (await plugin(`activeTheme('desktop')?.name ?? null`)) !== beforeName; i++) await wait(1000);
    check('after the test the active theme is back, CSS byte for byte', (await plugin(`themeCss('desktop')`)) === before, String(beforeName));

    await click(win, 'Start');
    const mine = (await rpcCall('ListThemes')).themes.filter((t) => t.source === 'user');
    const index = mine.findIndex((t) => t.name === NAME);
    await click(win, '🗑', index);
    await click(win, 'Delete');
    await wait(1500);
    check('Delete removes the theme and its folder', !existsSync(file) && !existsSync(`${userDir}\\${NAME}`));
    await click(win, 'Close');
} catch (error) {
    check('creator run', false, error instanceof Error ? error.message : String(error));
} finally {
    // Never leave the test theme behind.
    try {
        if ((await rpcCall('ListThemes')).themes.some((t) => t.name === NAME)) await rpcCall('DeleteTheme', { id: NAME, assets: true });
    } catch {
        /* the check above reports it */
    }
}
if (!failed) console.log('PASS  creator');
process.exit(failed ? 1 : 0);
