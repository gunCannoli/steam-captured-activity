// Debug probe: is the toast on screen the one whose render we traced?
// Compares notification ids: Steam's current toast, every dispatcher jsx call,
// and the K fiber in the toast window. Usage: node tests/probes/toast-identity.mjs
import { connect } from '../cdp.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const s = await connect();
await s.evaluate(`(() => {
    const rt = window.MILLENNIUM_API.findModuleByExport((e, n) => (n === 'jsx' || n === 'jsxs') && typeof e === 'function');
    let req; const key = '__en_id_' + Date.now();
    window.webpackChunksteamui.push([[key], { [key]: (m, e, r) => (req = r) }, (r) => r(key)]);
    let disp;
    for (const id of Object.keys(req.m)) {
        const src = req.m[id].toString();
        if (!src.includes('global_achieved_pct()') || !src.includes('Missing activate function')) continue;
        for (const v of Object.values(req(id))) if (typeof v === 'function' && /switch\\(\\w\\)\\{case/.test(v.toString()) && v.toString().includes('group')) disp = v;
    }
    window.__idTrace = [];
    const o = rt.jsx;
    rt.jsx = function (type, props) {
        const out = o.apply(this, arguments);
        if (type === disp) window.__idTrace.push({ t: Math.round(performance.now()), id: props?.group?.notifications?.[0]?.notificationID, result: out?.type === disp ? 'dispatcher' : out?.type?.name });
        return out;
    };
    window.__idRestore = () => (rt.jsx = o);
    return true;
})()`);
await s.evaluate(`(window.NotificationStore.TestDownloadComplete(435150), true)`);
await wait(1200);
const current = await s.evaluate(`window.NotificationStore.m_valueCurrentToast.m_currentValue?.notificationID ?? null`);
const trace = await s.evaluate(`JSON.stringify(window.__idTrace)`);
await s.evaluate(`(window.__idRestore(), true)`);
const t = (await (await fetch('http://127.0.0.1:8080/json')).json()).find((x) => /^notificationtoasts/.test(x.title));
const w = await connect(t.title);
const onScreen = await w.evaluate(`(() => {
    const el = document.querySelector('[class*=Title]');
    const fk = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    let f = el[fk];
    while (f && !(typeof f.type === 'function' && f.type.name === 'K')) f = f.return;
    return JSON.stringify({ kNotification: f?.memoizedProps?.notification?.notificationID ?? null, kChild: f?.child?.child?.sibling?.type?.name ?? null, fiberIsCurrent: f?.alternate ? 'has alternate' : 'no alternate' });
})()`);
console.log({ currentToast: current, trace: JSON.parse(trace), onScreen: JSON.parse(onScreen) });
w.close();
s.close();
