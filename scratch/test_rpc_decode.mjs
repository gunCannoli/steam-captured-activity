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

    // In frontend/rpc.ts:
    // const raw = await callFn.call(millennium, plugin, name, { payload: JSON.stringify(payload) });
    const rpcFn = `(async () => {
        const m = window.Millennium;
        const p = 'steam-cartridges-dev';
        // Test different invocation formats
        const t1 = await m.callServerMethod(p, 'CartridgesAchievementsGet', {
            payload: JSON.stringify({ shortcut_appid: 3048673328, native_appid: 0, hardcore: false })
        });
        return { t1 };
    })()`;

    const res = await evaluate(rpcFn);
    console.log('Result:', JSON.stringify(res, null, 2));
    ws.close();
}

run().catch(console.error);
