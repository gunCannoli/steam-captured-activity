// Debug probe: trace every dispatcher element creation across ALL jsx runtimes
// during one toast, then inspect that toast's DOM and fiber chain.
// Usage: node tests/probes/trace-toast.mjs "TestDownloadComplete(435150)"
import { connect } from '../cdp.mjs';

const call = process.argv[2] ?? 'TestDownloadComplete(435150)';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shared = await connect();

await shared.evaluate(`(() => {
    let req;
    const key = '__en_trace_' + Date.now();
    window.webpackChunksteamui.push([[key], { [key]: (m, e, r) => (req = r) }, (r) => r(key)]);
    const runtimes = [];
    let disp;
    for (const id of Object.keys(req.m)) {
        let mod; try { mod = req(id); } catch { continue; }
        if (mod && typeof mod.jsx === 'function' && typeof mod.jsxs === 'function') runtimes.push({ id, mod });
        const s = req.m[id].toString();
        if (s.includes('global_achieved_pct()') && s.includes('Missing activate function'))
            for (const v of Object.values(mod || {})) if (typeof v === 'function' && /switch\\(\\w\\)\\{case/.test(v.toString()) && v.toString().includes('group')) disp = v;
    }
    window.__trace = { seen: [], restore: [] };
    for (const r of runtimes) for (const k of ['jsx', 'jsxs']) {
        const o = r.mod[k];
        r.mod[k] = function (type, props) {
            const out = o.apply(this, arguments);
            if (type === disp) window.__trace.seen.push({ runtime: r.id, via: k, location: props?.location, eType: props?.group?.eType, result: out?.type === disp ? 'dispatcher' : out?.type?.name, stack: new Error().stack.split(String.fromCharCode(10)).slice(2, 5).map(s => s.trim().replace(/https?:[^ )]*[/]/g, '').slice(0, 70)) });
            return out;
        };
        window.__trace.restore.push(() => (r.mod[k] = o));
    }
    return true;
})()`);

await shared.evaluate(`(window.NotificationStore.${call}, true)`);
await wait(1500);
const seen = await shared.evaluate(`JSON.stringify(window.__trace.seen)`);
await shared.evaluate(`(window.__trace.restore.forEach((f) => f()), true)`);
console.log('dispatcher calls:', seen);

const t = (await (await fetch('http://127.0.0.1:8080/json')).json()).find((x) => /^notificationtoasts/i.test(x.title));
if (t) {
    const win = await connect(t.title);
    console.log(
        'toast DOM:',
        await win.evaluate(`JSON.stringify((() => {
            const el = document.querySelector('[class*=Title]');
            const fk = el && Object.keys(el).find((k) => k.startsWith('__reactFiber'));
            let f = fk && el[fk];
            const chain = [];
            while (f && chain.length < 16) { const ty = f.type; chain.push(typeof ty === 'string' ? ty : (ty?.name || 'anon')); f = f.return; }
            return { en: [...document.querySelectorAll('[data-en]')].map((e) => e.dataset.en), chain };
        })())`),
    );
    win.close();
}
shared.close();
