const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.title === 'SharedJSContext');
    if (!target) throw new Error('SharedJSContext not found');
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

    const res = await evaluate(`(() => {
        const shortcuts = [];
        for (const app of window.appStore.allApps) {
            if (app.app_type === 1073741824 || (app.appid >>> 0) >= 0x80000000) {
                shortcuts.push({
                    appid: app.appid >>> 0,
                    name: app.display_name,
                    hasIconData: Boolean(app.icon_data),
                    iconDataLen: app.icon_data ? app.icon_data.length : 0,
                    icon_data_format: app.icon_data_format,
                    icon_hash: app.icon_hash,
                    bIsMod: app.BIsModOrShortcut?.(),
                });
            }
        }
        const missing = shortcuts.filter(s => !s.hasIconData && !s.icon_hash);
        return {
            totalShortcuts: shortcuts.length,
            withIconData: shortcuts.filter(s => s.hasIconData).length,
            withIconHash: shortcuts.filter(s => s.icon_hash).length,
            missingCount: missing.length,
            missingSamples: missing.slice(0, 30)
        };
    })()`);

    console.log('Result:', JSON.stringify(res, null, 2));
    ws.close();
}

run().catch(console.error);
