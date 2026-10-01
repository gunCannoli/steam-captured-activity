// Step 0 probe: capture a live achievement notification and locate the toast renderer by signature.
import { connect } from '../cdp.mjs';

const cdp = await connect();
try {
    const result = await cdp.evaluate(`(async () => {
        const ns = window.NotificationStore;
        const proto = Object.getPrototypeOf(ns);
        const orig = proto.PlayNotificationSound;
        let seen = null;
        proto.PlayNotificationSound = function (n) {
            try {
                seen = {
                    eType: n.eType,
                    keys: Object.keys(n),
                    dataType: n.data?.constructor?.name,
                    dataMethods: n.data ? Object.getOwnPropertyNames(Object.getPrototypeOf(n.data)).slice(0, 40) : null,
                    pct: n.data?.global_achieved_pct?.(),
                    name: n.data?.name?.(),
                    appid: n.data?.appid?.(),
                    image: n.data?.image_url?.(),
                };
            } catch (e) { seen = { err: String(e) }; }
            return orig.apply(this, arguments);
        };
        try {
            await ns.TestAchievement(480);
            await new Promise(r => setTimeout(r, 1500));
        } finally {
            proto.PlayNotificationSound = orig;
        }

        // Locate the toast renderer by signature.
        let req;
        const key = '__ea_probe_' + Date.now();
        window.webpackChunksteamui.push([[key], { [key]: (m, e, r) => (req = r) }, (r) => r(key)]);
        const hits = [];
        for (const id of Object.keys(req.m)) {
            const src = req.m[id].toString();
            if (!src.includes('global_achieved_pct()') || !src.includes('achievement_id()')) continue;
            let mod; try { mod = req(id); } catch { continue; }
            for (const [k, v] of Object.entries(mod)) {
                if (typeof v !== 'function') continue;
                const s = v.toString();
                if (s.includes('global_achieved_pct()')) hits.push({ id, k, len: s.length, head: s.slice(0, 900) });
            }
            hits.push({ id, moduleOnly: true, exports: Object.keys(mod).length });
        }
        return { seen, hits };
    })()`);
    console.log(JSON.stringify(result, null, 2));
} finally {
    cdp.close();
}
