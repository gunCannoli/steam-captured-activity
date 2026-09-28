const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.title === 'SharedJSContext');
    const ws = new WebSocket(target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
    await new Promise(r => ws.onopen = r);
    const send = (method, params = {}) => new Promise(res => {
        const id = 1;
        const h = e => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener('message', h); res(m.result?.result?.value); } };
        ws.addEventListener('message', h);
        ws.send(JSON.stringify({ id, method, params }));
    });
    
    const inspectIgdb = async (title) => {
        const expr = `(async () => {
            const m = window['Millennium'];
            const res = await m.callServerMethod('steam-cartridges-dev', 'RefreshGameMetadata', {
                payload: JSON.stringify({ appid: 999999999, title })
            });
            return typeof res === 'string' ? JSON.parse(res) : res;
        })()`;
        return send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    };

    console.log('Testing "E.V.O.: Search for Eden"...');
    console.log(await inspectIgdb('E.V.O.: Search for Eden'));

    console.log('Testing "EVO Search for Eden"...');
    console.log(await inspectIgdb('EVO Search for Eden'));

    console.log('Testing "Mother 1+2"...');
    console.log(await inspectIgdb('Mother 1+2'));

    console.log('Testing "Mother 1 and 2"...');
    console.log(await inspectIgdb('Mother 1 and 2'));

    console.log('Testing "Prince of Persia (SNES)"...');
    console.log(await inspectIgdb('Prince of Persia'));

    ws.close();
}

run().catch(console.error);
