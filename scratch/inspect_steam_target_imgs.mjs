const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.id === '40A663F1E2746A558D9CAC71741F534E');
    const wsUrl = target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1');
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

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

    const imgs = await evaluate(`(() => {
        const results = [];
        for (const img of document.querySelectorAll('img')) {
            results.push({
                src: img.src,
                naturalWidth: img.naturalWidth,
                naturalHeight: img.naturalHeight,
                className: img.className,
                parentElementText: img.parentElement?.textContent?.trim()?.slice(0, 50)
            });
        }
        return results;
    })()`);

    console.log('Images in Steam target:');
    for (const img of imgs) {
        console.log(`- ${img.parentElementText || '[no text]'}: ${img.src.slice(0, 80)} (${img.naturalWidth}x${img.naturalHeight})`);
    }
    ws.close();
}

run().catch(console.error);
