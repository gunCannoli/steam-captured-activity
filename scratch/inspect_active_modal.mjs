const PORT = '8080';
async function run() {
    let list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
    const steamWin = list.find(t => t.title === 'Steam');
    const ws = new WebSocket(steamWin.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);
    
    let id = 1;
    const send = (m, p = {}) => new Promise(res => {
        const reqId = id++;
        const h = e => { const msg = JSON.parse(e.data); if (msg.id === reqId) { ws.removeEventListener('message', h); res(msg); } };
        ws.addEventListener('message', h);
        ws.send(JSON.stringify({ id: reqId, method: m, params: p }));
    });
    
    const inspectModal = await send('Runtime.evaluate', {
        expression: `(() => {
            const activeModal = document.querySelector('.ModalPosition, .DialogContent, [class*="ModalOverlay"]');
            return {
                text: activeModal ? activeModal.innerText : 'NO ACTIVE MODAL FOUND',
                sections: Array.from(document.querySelectorAll('.PanelSectionTitle, ._1IigUZ3GHaZS2Y-3V3T2rT')).map(e => e.innerText)
            };
        })()`,
        returnByValue: true
    });
    console.log('Active Modal Text:\n', inspectModal.result?.result?.value?.text);
    console.log('Sections:\n', inspectModal.result?.result?.value?.sections);
    
    ws.close();
}
run().catch(console.error);
