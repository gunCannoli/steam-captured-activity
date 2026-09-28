const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.title === 'Steam' && t.type === 'page' && !t.url.includes('SharedJSContext'));
    if (!target) throw new Error('Steam desktop window not found');
    const wsUrl = target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1');
    const ws = new WebSocket(wsUrl);
    await new Promise(r => ws.onopen = r);

    let id = 1;
    ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        console.log('Result:', JSON.stringify(m.result?.result?.value, null, 2));
        ws.close();
    };

    ws.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: {
            expression: `(() => {
                const text = document.body.innerText;
                const hasAchievementsText = text.includes('ACHIEVEMENTS') || text.includes('Achievements');
                const has98 = text.includes('98');
                const hasKonami = text.includes('Konami');
                const hasAnimaniacs = text.includes('Animaniacs');

                // Look for achievement badges or elements in DOM
                const achElements = document.querySelectorAll('[class*=\"achievement\"], [class*=\"Achievement\"]');
                const achSample = [];
                for (const el of achElements) {
                    const t = el.textContent?.trim();
                    if (t && t.length < 50) achSample.push(t);
                    if (achSample.length >= 10) break;
                }

                return {
                    hasAnimaniacs,
                    hasKonami,
                    hasAchievementsText,
                    has98,
                    achElementsCount: achElements.length,
                    achSample
                };
            })()`,
            returnByValue: true
        }
    }));
}
run().catch(console.error);
