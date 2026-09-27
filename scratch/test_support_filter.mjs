const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.title === 'Steam Big Picture Mode') || list.find((t) => t.title === 'SharedJSContext');
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
            // Find current links rendered on DOM if any
            const anchors = Array.from(document.querySelectorAll('a, [role=\"link\"]'));
            const linkTexts = anchors.map(a => a.textContent?.trim()).filter(Boolean);
            const helpLinks = anchors.filter(a => (a.href && a.href.includes('HelpWithGame')) || a.textContent?.includes('Support'));
            return {
                totalLinks: anchors.length,
                helpLinksCount: helpLinks.length,
                helpHrefs: helpLinks.map(a => a.href)
            };
        })()
    `);

    console.log('DOM check for Support links:', result);

    ws.close();
}

run();
