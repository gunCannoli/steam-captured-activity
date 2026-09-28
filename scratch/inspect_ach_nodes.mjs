const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find(t => t.title === 'Steam' && t.type === 'page' && !t.url.includes('SharedJSContext'));
    const ws = new WebSocket(target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
    await new Promise(r => ws.onopen = r);
    const send = (method, params = {}) => new Promise(res => {
        const id = 1;
        const h = e => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener('message', h); res(m.result?.result?.value); } };
        ws.addEventListener('message', h);
        ws.send(JSON.stringify({ id, method, params }));
    });
    const res = await send('Runtime.evaluate', {
        expression: `(() => {
            const achNodes = [...document.querySelectorAll('div[class*="achievement" i], div[class*="Achievement" i], div[class*="achieve" i]')];
            return achNodes.slice(0, 15).map(n => ({ className: n.className, text: n.innerText?.slice(0, 100) }));
        })()`,
        returnByValue: true
    });
    console.log('Achievement elements:\n', JSON.stringify(res, null, 2));
    ws.close();
}
run().catch(console.error);
