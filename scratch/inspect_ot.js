const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.title === 'SharedJSContext');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
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

    const result = await evaluate(`
        (() => {
            const chunk = window.webpackChunksteamui;
            let otSnippet = null;
            if (chunk) {
                chunk.push([['temp_check_ot_' + Math.random()], {}, (req) => {
                    const src = req.m['80478'].toString();
                    const idx = src.indexOf('const ot=');
                    if (idx !== -1) {
                        otSnippet = src.slice(idx, idx + 800);
                    } else {
                        const idx2 = src.indexOf('let ot=');
                        if (idx2 !== -1) otSnippet = src.slice(idx2, idx2 + 800);
                    }
                }]);
            }
            return otSnippet;
        })()
    `);

    console.log('ot function snippet:', result);

    ws.close();
}

run();
