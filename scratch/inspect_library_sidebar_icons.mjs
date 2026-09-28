const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    console.log('Available targets:', list.map(t => ({ id: t.id, title: t.title, type: t.type, url: t.url.slice(0, 60) })));

    // Find the main Steam window
    const target = list.find((t) => t.title === 'Steam' && t.type === 'page' && !t.url.includes('SharedJSContext'));
    if (!target) throw new Error('Main Steam window not found');
    console.log('Target found:', target.title, target.url);

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

    const sidebarInfo = await evaluate(`(() => {
        // Find elements with class containing 'applist' or 'AppList' or 'libraryHome'
        const items = document.querySelectorAll('[class*=\"applistitem\"], [class*=\"AppListItem\"], [class*=\"appRow\"]');
        const sampleItems = [];
        for (const item of items) {
            const text = item.textContent?.trim();
            const img = item.querySelector('img');
            const svg = item.querySelector('svg');
            const iconDiv = item.querySelector('[class*=\"icon\"], [class*=\"Icon\"]');
            sampleItems.push({
                text: text?.slice(0, 30),
                className: item.className,
                hasImg: Boolean(img),
                imgSrc: img ? img.src.slice(0, 60) : null,
                hasSvg: Boolean(svg),
                iconDivClass: iconDiv?.className,
                computedBg: iconDiv ? window.getComputedStyle(iconDiv).backgroundImage : null
            });
            if (sampleItems.length >= 20) break;
        }

        // Also check if there are games with broken/missing icon images
        const brokenImages = [];
        for (const img of document.querySelectorAll('img')) {
            if (img.naturalWidth === 0 && img.naturalHeight === 0 && img.src) {
                brokenImages.push({
                    src: img.src.slice(0, 100),
                    className: img.className,
                    alt: img.alt,
                    parentText: img.parentElement?.textContent?.slice(0, 30)
                });
            }
        }

        return {
            totalListItems: items.length,
            sampleItems,
            brokenImagesCount: brokenImages.length,
            brokenImagesSample: brokenImages.slice(0, 10)
        };
    })()`);

    console.log('Sidebar Info:\n', JSON.stringify(sidebarInfo, null, 2));
    ws.close();
}

run().catch(console.error);
