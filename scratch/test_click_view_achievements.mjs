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
            const btn = [...document.querySelectorAll('button, a, div[role=button]')].find(e => e.innerText?.includes('View My Achievements'));
            if (btn) {
                btn.click();
                return 'Clicked!';
            }
            return 'Not found';
        })()`,
        returnByValue: true
    });
    console.log('Click result:', res);
    ws.close();

    await new Promise(r => setTimeout(r, 1000));

    // Check targets again to see if a popup window opened
    const list2 = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    console.log('Targets after click:', list2.map(t => ({ title: t.title, type: t.type, url: t.url.slice(0, 80) })));
}
run().catch(console.error);
