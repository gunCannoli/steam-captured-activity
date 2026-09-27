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

    console.log('Test 1: calling with { payload: JSON.stringify(...) }');
    const res1 = await evaluate(`
        window.Millennium.callServerMethod('steam-cartridges-dev', 'CartridgesAchievementsGet', {
            payload: JSON.stringify({ shortcut_appid: 4263274102, native_appid: 0 })
        })
    `);
    console.log('Res 1:', res1);

    console.log('Test 2: calling SaveServiceCredentials with { payload: ... }');
    const res2 = await evaluate(`
        window.Millennium.callServerMethod('steam-cartridges-dev', 'SaveServiceCredentials', {
            payload: JSON.stringify({ test_key: 'test_val' })
        })
    `);
    console.log('Res 2:', res2);

    console.log('Test 3: calling SaveServiceCredentials with raw JSON string');
    const res3 = await evaluate(`
        window.Millennium.callServerMethod('steam-cartridges-dev', 'SaveServiceCredentials', JSON.stringify({ test_key: 'test_val' }))
    `);
    console.log('Res 3:', res3);

    ws.close();
}

run();
