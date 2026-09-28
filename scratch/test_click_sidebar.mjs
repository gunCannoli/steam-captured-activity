const PORT = '8080';
async function run() {
    let list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
    const steamWin = list.find(t => t.title === 'Steam');
    if (!steamWin) return console.log('Steam window not found');
    const ws = new WebSocket(steamWin.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);
    
    ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.method === 'Runtime.consoleAPICalled') {
            console.log('[Steam console]', m.params.type, m.params.args?.map(a => a.value || a.description));
        } else if (m.method === 'Runtime.exceptionThrown') {
            console.log('[Steam exception]', m.params.exceptionDetails);
        }
    };
    
    let id = 1;
    const send = (m, p = {}) => new Promise(res => {
        const reqId = id++;
        const h = e => { const msg = JSON.parse(e.data); if (msg.id === reqId) { ws.removeEventListener('message', h); res(msg); } };
        ws.addEventListener('message', h);
        ws.send(JSON.stringify({ id: reqId, method: m, params: p }));
    });
    
    await send('Console.enable');
    await send('Runtime.enable');
    
    console.log('Finding and clicking Steam Cartridges (dev) button in Steam window...');
    const clickResult = await send('Runtime.evaluate', {
        expression: `(() => {
            const btns = Array.from(document.querySelectorAll('.MillenniumDesktopSidebar_LibraryItemButton'));
            const cartBtn = btns.find(b => b.textContent.includes('Steam Cartridges'));
            if (!cartBtn) return { error: 'Button not found', buttons: btns.map(b => b.textContent) };
            
            // Click it
            cartBtn.click();
            return {
                clicked: true,
                btnText: cartBtn.textContent
            };
        })()`,
        returnByValue: true
    });
    console.log('Click result:', JSON.stringify(clickResult.result?.result?.value, null, 2));

    await new Promise(r => setTimeout(r, 1000));

    // Check what modals or containers opened in Steam window
    const postClick = await send('Runtime.evaluate', {
        expression: `(() => {
            const modals = Array.from(document.querySelectorAll('[class*="Modal"], [class*="Dialog"], [class*="Sidebar"], [class*="popup"]'))
                .map(el => ({ tag: el.tagName, cls: el.className, text: el.innerText?.slice(0, 80) }));
            return {
                modalsCount: modals.length,
                modals: modals.slice(-10)
            };
        })()`,
        returnByValue: true
    });
    console.log('Post click DOM state:', JSON.stringify(postClick.result?.result?.value, null, 2));
    
    ws.close();
}
run().catch(console.error);
