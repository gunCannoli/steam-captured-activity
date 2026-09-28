const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find(t => t.title === 'Steam Settings');
    if (!target) throw new Error('Steam Settings window not found');

    const ws = new WebSocket(target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
    await new Promise(r => ws.onopen = r);
    let id = 1;
    const send = (method, params = {}) => new Promise(res => {
        const i = id++;
        const h = e => { const m = JSON.parse(e.data); if (m.id === i) { ws.removeEventListener('message', h); res(m.result?.result?.value); } };
        ws.addEventListener('message', h);
        ws.send(JSON.stringify({ id: i, method, params }));
    });

    const res = await send('Runtime.evaluate', {
        expression: `(() => {
            const tabs = [...document.querySelectorAll('[class*="settingsTab" i], [class*="SettingsTab" i], div[role="tab"]')];
            return {
                title: document.title,
                tabs: tabs.map(t => ({ text: t.innerText, className: t.className })),
                allText: document.body.innerText.slice(0, 1000)
            };
        })()`,
        returnByValue: true
    });
    console.log('Steam Settings window inspection:\n', JSON.stringify(res, null, 2));

    ws.close();
}
run().catch(console.error);
