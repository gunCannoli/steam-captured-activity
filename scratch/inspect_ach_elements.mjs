const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.title === 'Steam' && t.type === 'page' && !t.url.includes('SharedJSContext'));
    if (!target) throw new Error('Steam desktop window not found');
    const ws = new WebSocket(target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
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
                const els = document.querySelectorAll('[class*=\"achievement\"], [class*=\"Achievement\"], [class*=\"RightColumn\"]');
                const list = [];
                for (const el of els) {
                    list.push({
                        tag: el.tagName,
                        className: el.className,
                        text: el.innerText?.slice(0, 100),
                        html: el.outerHTML?.slice(0, 300)
                    });
                    if (list.length >= 10) break;
                }
                return list;
            })()`,
            returnByValue: true
        }
    }));
}
run().catch(console.error);
