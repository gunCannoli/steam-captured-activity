// Live smoke test against a running Steam (-dev) with enhanced-achievements-dev deployed.
// Usage: node tests/smoke.mjs      (SCREENSHOT=out.png to also capture the toast window)
//   Checks the hooks are installed, fires Steam's test achievement, and asserts
//   the themed banner rendered in the toast window. Exit code 1 on failure.
import { connect } from './cdp.mjs';

const cdp = await connect();
let failed = false;
const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failed = true;
};

try {
    const state = JSON.parse(
        await cdp.evaluate(`JSON.stringify((() => {
            const proto = Object.getPrototypeOf(window.NotificationStore);
            return { soundHooked: !proto.PlayNotificationSound.toString().includes('PlayNavSound') };
        })())`),
    );
    check('sound hook installed on NotificationStore.prototype', state.soundHooked);

    // Steam's own test toast (global_achieved_pct 10). The plugin themes it like a real unlock.
    await cdp.evaluate(`window.NotificationStore.TestAchievement(480).then(() => true)`);
    // The first toast after a Steam start also has to create its popup window.
    let toast;
    for (let i = 0; i < 12 && !toast; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const targets = await (await fetch('http://127.0.0.1:8080/json')).json();
        toast = targets.find((t) => /notificationtoasts/i.test(t.title));
    }
    await new Promise((r) => setTimeout(r, 500));
    check('toast window opened', !!toast, toast?.title);
    if (toast) {
        const win = await connect(toast.title);
        const banner = JSON.parse(
            await win.evaluate(`JSON.stringify((() => {
                const b = document.querySelector('.ea-banner');
                if (!b) return { found: false, html: document.body.innerHTML.slice(0, 400) };
                const r = b.getBoundingClientRect();
                return {
                    found: true,
                    classes: b.className,
                    size: [Math.round(r.width), Math.round(r.height)],
                    title: b.querySelector('.ea-title')?.textContent,
                    icons: [...b.querySelectorAll('.ea-icon')].map((i) => i.className.replace('ea-icon ', '')),
                    background: getComputedStyle(b).backgroundImage.slice(0, 80),
                };
            })())`),
        );
        check('themed banner rendered', banner.found, banner.found ? JSON.stringify(banner) : banner.html);
        if (process.env.SCREENSHOT) console.log('screenshot:', await win.screenshot(process.env.SCREENSHOT));
        win.close();
    }
} finally {
    cdp.close();
}
process.exitCode = failed ? 1 : 0;
