const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.title === 'Steam' || (t.url.includes('minwidth=1010') && t.title !== 'SharedJSContext'));
    if (!target) throw new Error('Steam desktop window not found');
    const wsUrl = target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1');
    const ws = new WebSocket(wsUrl);
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

    const icons = await evaluate(`(() => {
        // Query sidebar app entries or app rows in desktop
        const rows = document.querySelectorAll('[class*=\"applistitem\"], [class*=\"AppListItem\"], [class*=\"appRow\"], [class*=\"libraryHome\"]');
        const imgElements = document.querySelectorAll('img');
        const iconImgs = [];
        for (const img of imgElements) {
            const src = img.src || '';
            const className = img.className || '';
            if (src.includes('base64') || src.includes('icon') || className.toLowerCase().includes('icon')) {
                iconImgs.push({
                    src: src.slice(0, 60),
                    className,
                    naturalWidth: img.naturalWidth,
                    naturalHeight: img.naturalHeight,
                    alt: img.alt,
                });
            }
            if (iconImgs.length >= 25) break;
        }

        // Check Animaniacs specifically in the DOM
        let animaniacsEl = null;
        for (const el of document.querySelectorAll('*')) {
            if (el.children.length === 0 && el.textContent === 'Animaniacs') {
                animaniacsEl = {
                    tag: el.tagName,
                    parentTag: el.parentElement?.tagName,
                    parentHTML: el.parentElement?.parentElement?.outerHTML?.slice(0, 500)
                };
                break;
            }
        }

        return {
            totalImgs: imgElements.length,
            iconImgs,
            animaniacsEl,
        };
    })()`);

    console.log('DOM Icon check:\n', JSON.stringify(icons, null, 2));
    ws.close();
}

run().catch(console.error);
