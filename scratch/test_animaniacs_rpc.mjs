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

    console.log('Calling CartridgesAchievementsGet for Animaniacs (3048673328)...');
    const res = await evaluate(`(async () => {
        try {
            const rpc = window.Millennium?.callServerMethod;
            if (!rpc) return { error: 'Millennium.callServerMethod not available' };
            const pluginName = 'steam-cartridges-dev';
            const raw = await rpc(pluginName, 'CartridgesAchievementsGet', {
                shortcut_appid: 3048673328,
                native_appid: 0,
                hardcore: false
            });
            return { raw };
        } catch (e) {
            return { caught: e.message || String(e) };
        }
    })()`);

    console.log('RPC result:\n', JSON.stringify(res, null, 2));
    ws.close();
}

run().catch(console.error);
