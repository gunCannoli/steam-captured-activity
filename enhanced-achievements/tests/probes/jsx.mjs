// Step 0 probe: confirm the toast dispatcher is created through react/jsx-runtime,
// and inspect the group shape and how toast duration is applied.
import { connect } from '../cdp.mjs';

const cdp = await connect();
try {
    const result = await cdp.evaluate(`(async () => {
        let req;
        const key = '__ea_probe_' + Date.now();
        window.webpackChunksteamui.push([[key], { [key]: (m, e, r) => (req = r) }, (r) => r(key)]);

        // Resolve by signature: an export whose source switches on eType and returns renderer components.
        let dispatcher, jsxRuntime;
        for (const id of Object.keys(req.m)) {
            const src = req.m[id].toString();
            let mod;
            if (!jsxRuntime && src.includes('jsxs') && src.includes('Fragment') && src.length < 3000) {
                try { mod = req(id); } catch { continue; }
                if (typeof mod?.jsx === 'function' && typeof mod?.jsxs === 'function') jsxRuntime = mod;
            }
            if (!dispatcher && src.includes('global_achieved_pct()') && src.includes('Missing activate function')) {
                try { mod = req(id); } catch { continue; }
                for (const v of Object.values(mod)) {
                    if (typeof v === 'function' && /switch\\(e\\)\\{case/.test(v.toString()) && v.toString().includes('group')) dispatcher = v;
                }
            }
        }
        if (!dispatcher || !jsxRuntime) return JSON.stringify({ dispatcher: !!dispatcher, jsxRuntime: !!jsxRuntime });

        const hits = [];
        const orig = { jsx: jsxRuntime.jsx, jsxs: jsxRuntime.jsxs };
        for (const k of ['jsx', 'jsxs']) {
            jsxRuntime[k] = function (type, props, k2) {
                if (type === dispatcher) {
                    const g = props.group;
                    hits.push({
                        via: k,
                        propKeys: Object.keys(props),
                        location: props.location,
                        groupKeys: g ? Object.keys(g) : null,
                        first: g?.notifications?.[0] ? { eType: g.notifications[0].eType, cls: g.notifications[0].data?.getClassName?.(), dur: g.notifications[0].nToastDurationMS } : null,
                        win: (props.ownerWindow || null) && 'has ownerWindow',
                    });
                }
                return orig[k].apply(this, arguments);
            };
        }
        const ns = window.NotificationStore;
        try {
            await ns.TestAchievement(480);
            await new Promise(r => setTimeout(r, 2500));
        } finally {
            Object.assign(jsxRuntime, orig);
        }
        const proto = Object.getPrototypeOf(ns);
        return JSON.stringify({
            writable: JSON.stringify(Object.getOwnPropertyDescriptor(jsxRuntime, 'jsx'), (k, v) => typeof v === 'function' ? 'fn' : v),
            hits: hits.slice(0, 5),
            hitCount: hits.length,
            dispatchNext: proto.DispatchNextToast.toString().slice(0, 900),
            processNotification: proto.ProcessNotification.toString().slice(0, 1200),
        });
    })()`);
    console.log(JSON.stringify(result, null, 2));
} finally {
    cdp.close();
}
