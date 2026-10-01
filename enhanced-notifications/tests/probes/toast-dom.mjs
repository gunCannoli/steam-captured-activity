// enhanced-notifications Step 0: dump a stock toast's DOM (tags, classes, paint)
// so restyling can target structure and resolved class maps, not hashed names.
// Usage: node tests/probes/toast-dom.mjs "TestDownloadComplete(435150)"
import { connect } from '../cdp.mjs';

const call = process.argv[2] ?? 'TestDownloadComplete(435150)';
const shared = await connect();
await shared.evaluate(`(window.NotificationStore.${call}, true)`);
let toast;
for (let i = 0; i < 12 && !toast; i++) {
    await new Promise((r) => setTimeout(r, 500));
    toast = (await (await fetch('http://127.0.0.1:8080/json')).json()).find((t) => new RegExp(process.env.TOAST_MATCH ?? 'notificationtoasts', 'i').test(t.title));
}
await new Promise((r) => setTimeout(r, 600));
const win = await connect(toast.title);
console.log(
    await win.evaluate(`(() => {
    const lines = [];
    const walk = (el, depth) => {
        if (depth > 9) return;
        const cs = getComputedStyle(el), r = el.getBoundingClientRect();
        const paint = [
            cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? 'bg=' + cs.backgroundColor : '',
            cs.backgroundImage !== 'none' ? 'bgimg=' + cs.backgroundImage.slice(0, 40) : '',
            el.childElementCount === 0 && el.textContent.trim() ? 'color=' + cs.color + ' font=' + cs.fontSize + '/' + cs.fontWeight + ' "' + el.textContent.trim().slice(0, 30) + '"' : '',
            cs.borderRadius !== '0px' ? 'radius=' + cs.borderRadius : '',
        ].filter(Boolean).join(' ');
        lines.push('  '.repeat(depth) + el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).join('.') : '') + ' [' + Math.round(r.width) + 'x' + Math.round(r.height) + '] ' + paint);
        for (const c of el.children) walk(c, depth + 1);
    };
    walk(document.body, 0);
    return lines.join('\\n');
})()`),
);
win.close();
shared.close();
