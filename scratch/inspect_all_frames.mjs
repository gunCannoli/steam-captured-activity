const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    for (const t of list) {
        if (!t.webSocketDebuggerUrl) continue;
        const wsUrl = t.webSocketDebuggerUrl.replace('localhost', '127.0.0.1');
        let ws;
        try {
            ws = new WebSocket(wsUrl);
            await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; setTimeout(rej, 1000); });
            let id = 0;
            const send = (method, params = {}) => new Promise((res) => {
                const i = ++id;
                const h = (e) => {
                    const m = JSON.parse(e.data);
                    if (m.id === i) {
                        ws.removeEventListener('message', h);
                        res(m.result?.result?.value);
                    }
                };
                ws.addEventListener('message', h);
                ws.send(JSON.stringify({ id: i, method, params }));
            });
            const evaluate = (expr) => send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
            const title = await evaluate('document.title');
            const url = await evaluate('window.location.href');
            const appRows = await evaluate('document.querySelectorAll("[class*=\\"applistitem\\"], [class*=\\"AppListItem\\"], [class*=\\"appRow\\"]").length');
            const images = await evaluate('document.querySelectorAll("img").length');
            console.log(`[Target ${t.id.slice(0, 8)}] title: "${title}" url: ${url?.slice(0, 50)} appRows: ${appRows} images: ${images}`);
            ws.close();
        } catch (e) {
            console.log(`[Target ${t.id.slice(0, 8)}] failed:`, e.message);
            if (ws) ws.close();
        }
    }
}

run().catch(console.error);
