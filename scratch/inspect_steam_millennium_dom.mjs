const PORT = '8080';
async function run() {
    let list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
    const steamWin = list.find(t => t.title === 'Steam');
    if (!steamWin) return console.log('Steam window not found');
    const ws = new WebSocket(steamWin.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);
    const send = (m, p = {}) => new Promise(res => {
        const id = Math.floor(Math.random() * 100000);
        const h = e => { const msg = JSON.parse(e.data); if (msg.id === id) { ws.removeEventListener('message', h); res(msg); } };
        ws.addEventListener('message', h);
        ws.send(JSON.stringify({ id, method: m, params: p }));
    });
    
    const r = await send('Runtime.evaluate', {
        expression: `(() => {
            const els = document.querySelectorAll('*');
            const found = [];
            for (const el of els) {
                const text = el.innerText || '';
                const cls = el.className || '';
                const id = el.id || '';
                if (typeof cls === 'string' && (cls.toLowerCase().includes('millennium') || id.toLowerCase().includes('millennium') || text.toLowerCase().includes('millennium'))) {
                    found.push({ tag: el.tagName, id, cls, text: text.slice(0, 50) });
                }
            }
            return found.slice(0, 20);
        })()`,
        returnByValue: true
    });
    console.log('Steam window elements matching millennium:', JSON.stringify(r.result?.result?.value, null, 2));
    ws.close();
}
run().catch(console.error);
