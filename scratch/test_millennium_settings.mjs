const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find(t => t.title === 'SharedJSContext');
    const ws = new WebSocket(target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
    await new Promise(r => ws.onopen = r);
    const send = (method, params = {}) => new Promise(res => {
        const id = Math.floor(Math.random() * 100000);
        const h = e => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener('message', h); res(m); } };
        ws.addEventListener('message', h);
        ws.send(JSON.stringify({ id, method, params }));
    });

    const m = await send('Runtime.evaluate', {
        expression: `(() => {
            const pl = window.PLUGIN_LIST;
            const c = pl ? pl['steam-cartridges'] : null;
            return {
                type: typeof c,
                keys: c ? Object.keys(c) : [],
                allKeys: c ? Object.getOwnPropertyNames(c) : [],
                stringVal: String(c)
            };
        })()`,
        returnByValue: true
    });
    console.log('Cartridges entry:', JSON.stringify(m.result?.result?.value, null, 2));

    // Also check other plugins in PLUGIN_LIST (e.g. enhanced-achievements-dev)
    const m2 = await send('Runtime.evaluate', {
        expression: `(() => {
            const pl = window.PLUGIN_LIST;
            const ea = pl ? pl['enhanced-achievements-dev'] : null;
            return {
                type: typeof ea,
                keys: ea ? Object.keys(ea) : [],
                title: ea?.title,
                hasContent: Boolean(ea?.content)
            };
        })()`,
        returnByValue: true
    });
    console.log('enhanced-achievements-dev entry:', JSON.stringify(m2.result?.result?.value, null, 2));

    ws.close();
}
run().catch(console.error);
