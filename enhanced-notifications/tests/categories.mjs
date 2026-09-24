// Live test: preview every category through the plugin's own previewCategory()
// and check the toast window was restyled (body data-en-type + popup paint), with
// Steam's content kept.
// SHOTS_DIR=<dir> saves a screenshot per category.
import { connect } from './cdp.mjs';

const PLUGIN = process.env.EN_PLUGIN ?? 'enhanced-notifications-dev';
const EA = 'enhanced-achievements-dev';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = await connect();
let failed = false;
const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failed = true;
};

async function toastWindow() {
    for (let i = 0; i < 12; i++) {
        await wait(500);
        const t = (await (await fetch('http://127.0.0.1:8080/json')).json()).find((x) => /^notificationtoasts/i.test(x.title));
        if (t) return t;
    }
    return null;
}

try {
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
