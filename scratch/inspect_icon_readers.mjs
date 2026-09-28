const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.title === 'SharedJSContext');
    const wsUrl = target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1');
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0;
    const send = (method, params = {}) => new Promise((res) => {
        const i = ++id;
        const h = (e) => {
            const m = JSON.parse(e.data);
            if (m.id === i) {
                ws.removeEventListener('message', h);
                res(m.result?.result?.value);
            }
        };
        ws.addEventListener('message', h);
        ws.send(JSON.stringify({ id: i, method, params }));
    });
    const evaluate = (expr) => send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });

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

    const result = await evaluate(`(() => {
        const req = window.__wreq;
        const callers = [];
        for (const [id, mod] of Object.entries(req.m)) {
            const src = mod.toString();
            if (src.includes('GetIconURLForApp')) {
                callers.push({ id, len: src.length, snippet: src.slice(0, 300) });
            }
        }
        return callers;
    })()`);

    console.log('Modules using GetIconURLForApp:\n', JSON.stringify(result, null, 2));
    ws.close();
}

run().catch(console.error);
