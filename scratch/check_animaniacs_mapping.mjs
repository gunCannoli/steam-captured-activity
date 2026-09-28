const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.title === 'SharedJSContext');
    const ws = new WebSocket(target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
    await new Promise(r => ws.onopen = r);
    let id = 1;
    ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        console.log('Result:', JSON.stringify(m.result?.result?.value, null, 2));
        ws.close();
    };
    ws.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: {
            expression: `(async () => {
                const rpc = window.Millennium.callServerMethod;
                const p = 'steam-cartridges-dev';
                const res = await rpc(p, 'SteamStoreGetMapping', {
                    payload: JSON.stringify({ appid: 3048673328 })
                });
                return { res };
            })()`,
            awaitPromise: true,
            returnByValue: true
        }
    }));
}
run().catch(console.error);
