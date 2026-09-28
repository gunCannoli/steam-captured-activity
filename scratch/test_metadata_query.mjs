const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.title === 'SharedJSContext');
    const ws = new WebSocket(target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
    await new Promise(r => ws.onopen = r);
    const send = (method, params = {}) => new Promise(res => {
        const id = Math.floor(Math.random() * 100000);
        const h = e => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener('message', h); res(m.result?.result?.value); } };
        ws.addEventListener('message', h);
        ws.send(JSON.stringify({ id, method, params }));
    });
    
    const callRpc = async (name, payload) => {
        const expr = `(async () => {
            const m = window['Millennium'];
            const res = await m.callServerMethod('steam-cartridges-dev', '${name}', {
                payload: JSON.stringify(${JSON.stringify(payload)})
            });
            return typeof res === 'string' ? JSON.parse(res) : res;
        })()`;
        return send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    };

    console.log('Querying EVO: Search for Eden...');
    const res1 = await callRpc('RefreshGameMetadata', { appid: 4227770158, title: 'E. V. O.: Search for Eden' });
    console.log('EVO response:', JSON.stringify(res1, null, 2));

    console.log('Querying Mother 1 + 2...');
    const res2 = await callRpc('RefreshGameMetadata', { appid: 2211260352, title: 'Mother 1 + 2' });
    console.log('Mother 1+2 response:', JSON.stringify(res2, null, 2));

    console.log('Querying DKC3...');
    const res3 = await callRpc('RefreshGameMetadata', { appid: 2173025092, title: "Donkey Kong Country 3: Dixie Kong's Double Trouble!" });
    console.log('DKC3 response:', JSON.stringify(res3, null, 2));

    console.log('Querying Prince of Persia...');
    const res4 = await callRpc('RefreshGameMetadata', { appid: 2943105341, title: 'Prince of Persia' });
    console.log('Prince of Persia response:', JSON.stringify(res4, null, 2));

    console.log('Querying Patrick Star in Mario Kart Super Circuit...');
    const res5 = await callRpc('RefreshGameMetadata', { appid: 4276481436, title: 'Patrick Star in Mario Kart Super Circuit' });
    console.log('Patrick Star response:', JSON.stringify(res5, null, 2));

    ws.close();
}

run().catch(console.error);
