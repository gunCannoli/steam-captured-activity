const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.title === 'SharedJSContext');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        pending.get(m.id)?.(m);
        pending.delete(m.id);
    };
    const send = (method, params = {}) =>
        new Promise((res) => {
            pending.set(++id, res);
            ws.send(JSON.stringify({ id, method, params }));
        });
    const evaluate = async (expr) => {
        const r = await send('Runtime.evaluate', {
            expression: expr,
            returnByValue: true,
            awaitPromise: true,
        });
        return r.result?.result?.value;
    };

    const result = await evaluate(`
        (() => {
            const chunk = window.webpackChunksteamui;
            let mod52470 = null;
            if (chunk) {
                chunk.push([['temp_inspect_links_' + Math.random()], {}, (req) => {
                    mod52470 = req('52470');
                }]);
            }
            if (!mod52470) return { error: 'mod 52470 not found' };

            const N = mod52470.Qd;
            // Test with a mock non-steam overview that has BIsModOrShortcut: () => false (like our proxy)
            const mockOverview = {
                appid: 2820820,
                BIsModOrShortcut: () => false,
                app_type: 1,
            };
            const mockDetails = { bAvailableContentOnStore: true };
            
            // Invoke N
            try {
                const el = N({ overview: mockOverview, details: mockDetails });
                const links = el?.props?.links || [];
                return {
                    success: true,
                    elementPropsKeys: Object.keys(el?.props || {}),
                    linksCount: links.length,
                    linksLabels: links.map(l => l.link || l.label),
                    hasSupport: links.some(l => l.link === 'HelpAppPage' || String(l.url).includes('HelpWithGame'))
                };
            } catch (err) {
                return { error: String(err), stack: err?.stack };
            }
        })()
    `);

    console.log('Test N invocation result:', JSON.stringify(result, null, 2));

    ws.close();
}

run();
