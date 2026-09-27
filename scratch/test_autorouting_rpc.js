const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.title === 'SharedJSContext');
    if (!target) {
        console.error('SharedJSContext not found among targets:', list.map(t => t.title));
        process.exit(1);
    }
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

    console.log('Testing GetAutoRoutingProfiles via Millennium RPC...');
    const res = await evaluate(`
        window.Millennium.callServerMethod('steam-cartridges-dev', 'GetAutoRoutingProfiles', {})
    `);
    console.log('GetAutoRoutingProfiles returned type:', typeof res);
    const parsed = typeof res === 'string' ? JSON.parse(res) : res;
    const profiles = parsed?.profiles || {};
    console.log('Profiles count:', Object.keys(profiles).length);

    for (const [key, profile] of Object.entries(profiles)) {
        if (!key.startsWith('-')) { // only log positive keys to avoid duplication
            console.log(`[${profile.category}] appid=${key} program="${profile.program}"`);
        }
    }

    ws.close();
}

run().catch((err) => {
    console.error('Error running test:', err);
    process.exit(1);
});
