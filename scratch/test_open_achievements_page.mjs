const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.title === 'SharedJSContext');
    const ws = new WebSocket(target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
    await new Promise(r => ws.onopen = r);
    
    let id = 0;
    const send = (method, params = {}) => new Promise(res => {
        const i = ++id;
        const h = e => {
            const m = JSON.parse(e.data);
            if (m.id === i) { ws.removeEventListener('message', h); res(m.result?.result?.value); }
        };
        ws.addEventListener('message', h);
        ws.send(JSON.stringify({ id: i, method, params }));
    });
    
    console.log('Navigating to Animaniacs achievements page...');
    await send('Runtime.evaluate', {
        expression: 'window.MILLENNIUM_API.Navigation.Navigate("/library/app/3048673328/achievements")',
        awaitPromise: true,
        returnByValue: true
    });
    
    await new Promise(r => setTimeout(r, 2000));
    
    // Connect to Steam desktop window and check what's rendered
    const list2 = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const steamTarget = list2.find(t => t.title === 'Steam' && t.type === 'page' && !t.url.includes('SharedJSContext'));
    if (steamTarget) {
        const ws2 = new WebSocket(steamTarget.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
        await new Promise(r => ws2.onopen = r);
        const send2 = (method, params = {}) => new Promise(res => {
            const i = ++id;
            const h = e => {
                const m = JSON.parse(e.data);
                if (m.id === i) { ws2.removeEventListener('message', h); res(m.result?.result?.value); }
            };
            ws2.addEventListener('message', h);
            ws2.send(JSON.stringify({ id: i, method, params }));
        });
        const res = await send2('Runtime.evaluate', {
            expression: `(() => {
                const text = document.body.innerText;
                const badges = [...document.querySelectorAll('img[src*="Badge"], img[src*="retroachievements"]')].map(i => i.src);
                return {
                    url: window.location.href,
                    bodySnippet: text.slice(0, 300),
                    hasAnimaniacs: text.includes('Animaniacs'),
                    hasAchievementsText: text.includes('Mastermaniacs') || text.includes('Narf!'),
                    badgeCount: badges.length,
                    sampleBadges: badges.slice(0, 5)
                };
            })()`,
            returnByValue: true
        });
        console.log('Achievements page render:', JSON.stringify(res, null, 2));
        ws2.close();
    }
    ws.close();
}

run().catch(console.error);
