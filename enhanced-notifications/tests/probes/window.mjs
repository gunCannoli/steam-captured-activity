// Step 0 probe: ProcessNotification wrappability and the desktop toast window geometry.
import { connect } from '../cdp.mjs';

const cdp = await connect();
try {
    const before = await cdp.evaluate(`JSON.stringify((() => {
        const ns = window.NotificationStore, proto = Object.getPrototypeOf(ns);
        const d = (o, k) => { const x = Object.getOwnPropertyDescriptor(o, k); return x && { get: !!x.get, value: typeof x.value, writable: x.writable, configurable: x.configurable }; };
        return { protoPN: d(proto, 'ProcessNotification'), ownPN: d(ns, 'ProcessNotification'), ownPNS: d(ns, 'PlayNotificationSound') };
    })())`);
    console.log('descriptors', before);

    await cdp.evaluate(`(window.NotificationStore.TestAchievement(480), true)`);
    await new Promise((r) => setTimeout(r, 1200));
    const targets = await (await fetch('http://127.0.0.1:8080/json')).json();
    console.log(targets.filter((t) => /toast|notif/i.test(t.title + t.url)).map((t) => `${t.title} | ${t.url.slice(0, 160)}`));

    const toast = targets.find((t) => /notificationtoasts/i.test(t.title + t.url));
    if (toast) {
        const tcdp = await connect(toast.title);
        console.log('toast window', await tcdp.evaluate(`JSON.stringify({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, body: document.body.innerHTML.length, alert: (() => { const a = document.querySelector('[role=alert]'); if (!a) return null; const r = a.getBoundingClientRect(); return { w: r.width, h: r.height, cls: a.className, style: a.getAttribute('style') }; })() })`));
        tcdp.close();
    }
} finally {
    cdp.close();
}
