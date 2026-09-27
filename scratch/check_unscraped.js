const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.title === 'SharedJSContext');
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
    const send = (method, params = {}) => new Promise((res) => {
        pending.set(++id, res);
        ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expr) => {
        const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        return r.result?.result?.value;
    };

    const metaRes = await evaluate(`window.Millennium.callServerMethod('steam-cartridges-dev', 'GetAllMetadata', {})`);
    const meta = typeof metaRes === 'string' ? JSON.parse(metaRes) : metaRes;
    const library = meta?.library || {};
    console.log('Metadata entries count in DB:', Object.keys(library).length);

    // Let's also check shortcuts count in SteamClient
    const shortcuts = await evaluate(`
        Array.from(window.appStore?.allApps?.values() || [])
            .filter(a => a.app_type === 1073741824 || a.appid >= 0x80000000)
            .map(a => ({ appid: a.appid, name: a.display_name }))
    `);
    console.log('Shortcuts count in Steam:', shortcuts?.length);

    // Let's check how many have metadata in library
    let scrapedCount = 0;
    const unscraped = [];
    for (const sc of shortcuts || []) {
        const entry = library[String(sc.appid)] || library[String(sc.appid >>> 0)] || library[String(sc.appid | 0)];
        if (entry) {
            scrapedCount++;
        } else {
            unscraped.push(sc);
        }
    }
    console.log('Scraped shortcuts:', scrapedCount);
    console.log('Unscraped shortcuts:', unscraped.length);
    console.log('Sample unscraped games:', unscraped.slice(0, 10));

    console.log('Testing RefreshGameMetadata on ActRaiser (appid: 2788628389)...');
    const t0 = Date.now();
    const refreshRes = await evaluate(`
        window.Millennium.callServerMethod('steam-cartridges-dev', 'RefreshGameMetadata', {
            payload: JSON.stringify({ appid: 2788628389, title: 'ActRaiser' })
        })
    `);
    console.log('Elapsed ms:', Date.now() - t0);
    console.log('RefreshGameMetadata result:', refreshRes);

    ws.close();
}

run().catch(console.error);
