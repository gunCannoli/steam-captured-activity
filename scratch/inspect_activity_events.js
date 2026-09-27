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
            let eventClassMod = null;
            let headlines = [];
            let renderSnippets = {};
            if (chunk) {
                chunk.push([['temp_search_80478_' + Math.random()], {}, (req) => {
                    const src = req.m['80478'].toString();
                    for (const tok of ['PlayedGameFirstTime', 'ReceivedNewGame', 'AddRecommendedGameEvent']) {
                        const idx = src.indexOf(tok);
                        if (idx !== -1) {
                            renderSnippets[tok] = src.slice(Math.max(0, idx - 200), idx + 600);
                        }
                    }
                }]);
            }
            return renderSnippets;
        })()
    `);

    console.log('AppActivity tokens found:', result);

    ws.close();
}

run();
