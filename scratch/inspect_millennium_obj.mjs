const PORT = '8080';
async function run() {
    let list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
    const shared = list.find(t => t.title === 'SharedJSContext');
    const ws = new WebSocket(shared.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);
    const send = (m, p = {}) => new Promise(res => {
        const id = Math.floor(Math.random() * 100000);
        const h = e => { const msg = JSON.parse(e.data); if (msg.id === id) { ws.removeEventListener('message', h); res(msg); } };
        ws.addEventListener('message', h);
        ws.send(JSON.stringify({ id, method: m, params: p }));
    });
    
    const r = await send('Runtime.evaluate', {
        expression: `({
            millenniumKeys: Object.keys(window.Millennium || {}),
            apiKeys: Object.keys(window.MILLENNIUM_API || {}),
            sidebarPanels: Object.keys(window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS || {}),
            settingsStore: window.MILLENNIUM_PLUGIN_SETTINGS_STORE
        })`,
        returnByValue: true
    });
    console.log(JSON.stringify(r.result?.result?.value, null, 2));
    ws.close();
}
run().catch(console.error);
