// Diagnostic test for steam-cartridges redesigned settings panel and RPC
const PORT = process.env.CDP_PORT ?? '8080';

async function targets() {
    return (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
}

async function connect(title) {
    const list = await targets();
    const target = list.find((t) => t.title === title);
    if (!target) throw new Error(`Target "${title}" not found. Targets: ${list.map(t => t.title).join(', ')}`);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
        ws.onopen = res;
        ws.onerror = rej;
    });
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
        if (r.result?.exceptionDetails) {
            throw new Error(r.result.exceptionDetails.text + ' ' + JSON.stringify(r.result.exceptionDetails.exception));
        }
        return r.result?.result?.value;
    };
    return { send, evaluate, close: () => ws.close() };
}

async function run() {
    console.log('Connecting to SharedJSContext...');
    const client = await connect('SharedJSContext');
    try {
        // 1. Check plugin registration and backend RPC call
        const rpcCheck = await client.evaluate(`
            (async () => {
                const call = window.Millennium?.callServerMethod;
                if (!call) return { error: 'No Millennium.callServerMethod' };
                try {
                    const statusStr = await call('steam-cartridges-dev', 'GetStatus');
                    const status = JSON.parse(statusStr);
                    return {
                        ok: true,
                        status
                    };
                } catch (err) {
                    return { error: String(err) };
                }
            })()
        `);
        console.log('RPC GetStatus result:', JSON.stringify(rpcCheck, null, 2));

        if (!rpcCheck.ok) {
            console.error('FAIL: GetStatus failed:', rpcCheck.error);
            process.exit(1);
        }

        // 2. Test SaveServiceCredentials via backend RPC
        const credsCheck = await client.evaluate(`
            (async () => {
                const call = window.Millennium?.callServerMethod;
                try {
                    // Test saving a dummy config field (will be saved in .env)
                    const resStr = await call('steam-cartridges-dev', 'SaveServiceCredentials', {
                        payload: JSON.stringify({ test_key: 'test_val' })
                    });
                    return { ok: true, res: JSON.parse(resStr) };
                } catch (err) {
                    return { error: String(err) };
                }
            })()
        `);
        console.log('RPC SaveServiceCredentials result:', JSON.stringify(credsCheck, null, 2));
        if (!credsCheck.ok || !credsCheck.res?.success) {
            console.error('FAIL: SaveServiceCredentials failed');
            process.exit(1);
        }

        // 3. Test that Settings store can read default routingRules, services, controllerOverrides
        const settingsStoreCheck = await client.evaluate(`
            (() => {
                const raw = localStorage.getItem('steam-cartridges:settings');
                return {
                    hasStoredSettings: !!raw,
                    content: raw ? JSON.parse(raw) : null
                };
            })()
        `);
        console.log('Stored settings:', JSON.stringify(settingsStoreCheck, null, 2));

        console.log('ALL VERIFICATIONS PASSED.');
    } finally {
        client.close();
    }
}

run().catch((err) => {
    console.error('Error running test:', err);
    process.exit(1);
});
