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
            const details = {};
            if (chunk) {
                chunk.push([['temp_check_mods_' + Math.random()], {}, (req) => {
                    for (const mid of ['46424', '97561']) {
                        const src = req.m[mid]?.toString() || '';
                        details[mid] = {
                            srcSnippet: src.slice(0, 300),
                            exports: Object.keys(req(mid) || {})
                        };
                    }
                }]);
            }
            return details;
        })()
    `);

    console.log('Modules details:', JSON.stringify(result, null, 2));

    ws.close();
}

run();
