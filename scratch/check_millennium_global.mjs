const PORT = '8080';
async function run() {
    let list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
    for (const t of list) {
        if (!t.webSocketDebuggerUrl) continue;
        const ws = new WebSocket(t.webSocketDebuggerUrl);
        await new Promise(r => { ws.onopen = r; ws.onerror = () => r(); });
        if (ws.readyState !== 1) continue;
        const send = (m, p = {}) => new Promise(res => {
            const id = Math.floor(Math.random() * 100000);
            const h = e => { const msg = JSON.parse(e.data); if (msg.id === id) { ws.removeEventListener('message', h); res(msg); } };
            ws.addEventListener('message', h);
            ws.send(JSON.stringify({ id, method: m, params: p }));
        });
        const r = await send('Runtime.evaluate', {
            expression: 'Object.keys(window).filter(k => k.toLowerCase().includes("millennium"))',
            returnByValue: true
        });
        const val = r.result?.result?.value;
        if (val && val.length > 0) {
            console.log(t.title, ':', val);
        }
        ws.close();
    }
}
run().catch(console.error);
