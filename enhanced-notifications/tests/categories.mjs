// Live test: preview every category through the plugin's own previewCategory()
// and check the toast window was restyled (body data-en-type + popup paint), with
// Steam's content kept.
// SHOTS_DIR=<dir> saves a screenshot per category.
import { connect, resolvePluginName } from './cdp.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = await connect();
const PLUGIN = await resolvePluginName(cdp, 'EN_PLUGIN', 'enhanced-notifications');
const EA = await resolvePluginName(cdp, 'EA_PLUGIN', 'enhanced-achievements');
let failed = false;
const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failed = true;
};

// The Big Picture toast window is persistent (one popup reused for every toast),
// so "the target exists" is not "Steam showed a toast": it exists even when idle.
// Wait for content too, and treat an empty window the same as no window at all
// (docs/plans/enhanced-notifications-toast-window-bugfix.md).
async function toastWindow() {
    let t = null;
    for (let i = 0; i < 12 && !t; i++) {
        await wait(500);
        t = (await (await fetch('http://127.0.0.1:8080/json')).json()).find((x) => /^notificationtoasts/i.test(x.title));
    }
    if (!t) return null;
    // Window found (it may be Big Picture's persistent, possibly-idle popup): wait up to
    // ~6s total for content, once, then treat "still empty" the same as "no window".
    for (let j = 0; j < 12; j++) {
        const win = await connect(t.title);
        const hasContent = await win.evaluate(`document.body.innerText.trim() !== ''`);
        win.close();
        if (hasContent) return t;
        await wait(500);
    }
    return null;
}

try {
    const uiMode = await cdp.evaluate(`SteamClient.UI.GetUIMode?.()`);
    console.log(`UI mode: ${uiMode} (0/1 = desktop, 4 = Big Picture)`);
    const eaClaimsBanner = await cdp.evaluate(`!!window.PLUGIN_LIST['${EA}']?.claims?.('banner')`);
    for (const category of ['friends', 'messages', 'downloads', 'recording', 'system', 'achievement']) {
        await cdp.evaluate(`window.PLUGIN_LIST['${PLUGIN}'].previewCategory('${category}').then(() => true, (e) => String(e))`);
        const t = await toastWindow();
        if (!t) {
            // Friend/message toasts depend on Steam's Friends notification settings.
            const optional = category === 'friends' || category === 'messages';
            if (optional) console.log(`SKIP  ${category}: Steam showed no toast (Friends notification settings)`);
            else check(`${category}: toast shown`, false, 'no toast window');
            continue;
        }
        await wait(700);
        const win = await connect(t.title);
        const r = JSON.parse(
            await win.evaluate(`JSON.stringify((() => {
                const popup = document.querySelector('[class*=DesktopToastPopup], [class*=GamepadToastPopup]');
                const cs = popup && getComputedStyle(popup);
                return {
                    type: document.body.getAttribute('data-en-type'),
                    ea: !!document.querySelector('.ea-banner'),
                    background: cs ? cs.backgroundImage.slice(0, 60) : null,
                    border: cs ? cs.borderTopWidth + ' ' + cs.borderTopColor : null,
                    logoKept: !!document.querySelector('img'),
                    text: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 60),
                };
            })())`),
        );
        if (category === 'achievement' && eaClaimsBanner) {
            check(`${category}: left to Enhanced Achievements`, r.ea && !r.type, JSON.stringify(r));
        } else {
            check(`${category}: restyled in place`, !!r.type && r.background?.startsWith('linear-gradient'), JSON.stringify(r));
        }
        if (process.env.SHOTS_DIR) await win.screenshot(`${process.env.SHOTS_DIR}/en-${category}.png`);
        win.close();
        await wait(6500);
    }
} finally {
    cdp.close();
}
process.exitCode = failed ? 1 : 0;
