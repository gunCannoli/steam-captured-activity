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

    // Test calling with JSON string vs object
    const r1 = await evaluate(`window.Millennium?.callServerMethod('steam-cartridges-dev', 'CartridgesAchievementsGet', JSON.stringify({ shortcut_appid: 3048673328, native_appid: 0 }))`);
    console.log('Call with JSON.stringify:\n', r1);

    const r2 = await evaluate(`window.Millennium?.callServerMethod('steam-cartridges-dev', 'CartridgesAchievementsGet', { shortcut_appid: 3048673328, native_appid: 0 })`);
    console.log('Call with object:\n', r2);

    ws.close();
}

run().catch(console.error);
