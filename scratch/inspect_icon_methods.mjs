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

    const res = await evaluate(`(() => {
        const o = window.appStore.allApps.find(a => (a.appid >>> 0) >= 0x80000000);
        const props = [];
        let c = o;
        while (c && c !== Object.prototype) {
            props.push(...Object.getOwnPropertyNames(c));
            c = Object.getPrototypeOf(c);
        }
        return {
            iconProps: props.filter(p => p.toLowerCase().includes('icon')),
            allProps: props
        };
    })()`);

    console.log('Result:', JSON.stringify(res.iconProps, null, 2));
    ws.close();
}

run().catch(console.error);
