const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.title === 'SharedJSContext');
    if (!target) throw new Error('SharedJSContext not found');
    const wsUrl = target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1');
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        pending.get(m.id)?.(m);
        pending.delete(m.id);
    };
    const send = (method, params = {}) =>
        new Promise((res) => {
            pending.set(++id, res);
            ws.send(JSON.stringify({ id, method, params }));
        });
    const evaluate = async (expr) => {
        const r = await send('Runtime.evaluate', {
            expression: expr,
            returnByValue: true,
            awaitPromise: true,
        });
        return r.result?.result?.value;
    };

    // Grab wreq
    await evaluate(`(() => {
        if (!window.__wreq) {
            let req = null;
            window.webpackChunksteamui.push([
                ["probe_" + Date.now()],
                { probe_mod: (m, e, r) => { req = r; } },
                (r) => { r((r.s = "probe_mod")); }
            ]);
            window.__wreq = req;
        }
    })()`);

    const contexts = await evaluate(`(() => {
        const req = window.__wreq;
        if (!req || !req.m) return {};
        const res = {};
        for (const id of ['1776', '81659', '81062']) {
            if (req.m[id]) {
                const src = req.m[id].toString();
                let idx = 0;
                const matches = [];
                while ((idx = src.indexOf('icon_data', idx)) !== -1) {
                    matches.push(src.slice(Math.max(0, idx - 100), Math.min(src.length, idx + 250)));
                    idx += 10;
                    if (matches.length >= 3) break;
                }
                res[id] = matches;
            }
        }
        return res;
    })()`);

    console.log('Contexts:\n', JSON.stringify(contexts, null, 2));
    ws.close();
}

run().catch(console.error);
