// Live Big Picture check. Run with Big Picture open
// (SteamClient.URL.ExecuteSteamURL('steam://open/bigpicture')).
// Fires Steam's test achievement and asserts the themed banner renders in Big
// Picture's toast window. SCREENSHOT=out.png captures it.
import { connect } from './cdp.mjs';

const cdp = await connect();
let failed = false;
try {
    await cdp.evaluate(`window.NotificationStore.TestAchievement(480).then(() => true)`);
    await new Promise((r) => setTimeout(r, 1200));
    const targets = await (await fetch('http://127.0.0.1:8080/json')).json();
    const toast = targets.find((t) => /^notificationtoasts_uid/i.test(t.title));
    if (!toast) throw new Error('No Big Picture toast window; is Big Picture open?');
    const win = await connect(toast.title);
    const result = JSON.parse(
        await win.evaluate(`JSON.stringify((() => {
            const b = document.querySelector('.ea-banner');
            if (!b) return { found: false };
            const r = b.getBoundingClientRect(), p = b.parentElement.getBoundingClientRect();
            return { found: true, classes: b.className, banner: [Math.round(r.width), Math.round(r.height)], frame: [Math.round(p.width), Math.round(p.height)], focused: document.activeElement?.closest?.('.ea-banner') ? 'banner' : document.activeElement?.tagName };
        })())`),
    );
    console.log(`${result.found ? 'PASS' : 'FAIL'}  themed banner in Big Picture toast  ${JSON.stringify(result)}`);
    if (!result.found) failed = true;
    if (result.found && result.focused === 'banner') {
        console.log('FAIL  banner took focus (would steal controller focus)');
        failed = true;
    }
    if (process.env.SCREENSHOT) await win.screenshot(process.env.SCREENSHOT);

    // Big Picture times the toast itself (no popup hold there), so Steam's
    // duration must cover the whole banner: the exit animation has to finish
    // (opacity ~0) before Steam removes the banner, never be cut mid-way.
    if (result.found) {
        let last = null;
        for (let t = 0; t < 30_000; t += 100) {
            const s = await win.evaluate(`(() => { const b = document.querySelector('.ea-banner'); return b ? Number(getComputedStyle(b).opacity) : null; })()`);
            if (s === null) break;
            last = s;
            await new Promise((r) => setTimeout(r, 100));
        }
        const ok = last !== null && last < 0.1;
        console.log(`${ok ? 'PASS' : 'FAIL'}  exit animation finished before Steam removed the banner  (last opacity ${last})`);
        if (!ok) failed = true;
    }
    win.close();
} finally {
    cdp.close();
}
process.exitCode = failed ? 1 : 0;
