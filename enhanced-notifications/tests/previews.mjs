// Live test: press the settings panel's Preview (the plugin's own preview()) several times and check each toast is a
// different type from the one before and is restyled in place (body data-en-type + popup paint), with Steam's
// content kept; then preview DownloadComplete by id. SHOTS_DIR=<dir> saves a screenshot per toast.
import { connect, resolvePluginName } from './cdp.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = await connect();
const PLUGIN = await resolvePluginName(cdp, 'EN_PLUGIN', 'enhanced-notifications');
let failed = false;
const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failed = true;
};

// The Big Picture toast window is persistent (one popup reused for every toast),
// so "the target exists" is not "Steam showed a toast": it exists even when idle.
// Wait for content too, and treat an empty window the same as no window at all.
async function toastWindow() {
    let t = null;
    for (let i = 0; i < 12 && !t; i++) {
        await wait(500);
        t = (await (await fetch('http://127.0.0.1:8080/json')).json()).find((x) => /^notificationtoasts/i.test(x.title));
    }
    if (!t) return null;
    for (let j = 0; j < 12; j++) {
        const win = await connect(t.title);
        const hasContent = await win.evaluate(`document.body.innerText.trim() !== ''`);
        if (hasContent) return win;
        win.close();
        await wait(500);
    }
    return null;
}

/** Preview (random, or `id`), then read the toast window. */
async function show(id) {
    const shown = await cdp.evaluate(`window.PLUGIN_LIST['${PLUGIN}'].preview(${id ? JSON.stringify(id) : ''})`);
    const win = await toastWindow();
    if (!win) return { shown, r: null };
    await wait(700);
    const r = JSON.parse(
        await win.evaluate(`JSON.stringify((() => {
            const popup = document.querySelector('[class*=DesktopToastPopup], [class*=GamepadToastPopup]');
            const cs = popup && getComputedStyle(popup);
            return {
                type: document.body.getAttribute('data-en-type'),
                background: cs ? cs.backgroundImage.slice(0, 60) : null,
                text: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 60),
            };
        })())`),
    );
    if (process.env.SHOTS_DIR) await win.screenshot(`${process.env.SHOTS_DIR}/en-${shown}.png`);
    win.close();
    await wait(6500); // let the toast go before the next one
    return { shown, r };
}

try {
    const uiMode = await cdp.evaluate(`SteamClient.UI.GetUIMode?.()`);
    console.log(`UI mode: ${uiMode} (0/1 = desktop, 4 = Big Picture)`);
    // Big Picture reuses one toast window: let a toast left by the previous script go first.
    if (uiMode === 4) await wait(6500);
    const ids = await cdp.evaluate(`window.PLUGIN_LIST['${PLUGIN}'].previewIds()`);
    console.log(`preview ids: ${ids.join(', ')}`);
    let last = null;
    const seen = new Set();
    for (let i = 0; i < 4; i++) {
        const { shown, r } = await show();
        check(`random preview ${i + 1}: ${shown}, not the same as the one before`, !!shown && shown !== last, `last ${last}`);
        check(`random preview ${i + 1}: restyled in place`, !!r?.type && !!r.text && r.background?.startsWith('linear-gradient'), JSON.stringify(r));
        seen.add((last = shown));
    }
    check('random previews show different types', seen.size >= 3, [...seen].join(', '));
    const { shown, r } = await show('DownloadComplete');
    check('DownloadComplete: restyled in place', shown === 'DownloadComplete' && r?.type === 'DownloadComplete' && r.background?.startsWith('linear-gradient'), JSON.stringify(r));
} finally {
    cdp.close();
}
process.exitCode = failed ? 1 : 0;
