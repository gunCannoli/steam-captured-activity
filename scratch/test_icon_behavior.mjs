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

    // Grab wreq
    await evaluate(`(() => {
        if (!window.__wreq) {
            let req = null;
            window.webpackChunksteamui.push([
                ["probe_" + Date.now()],
                { probe_mod: (m, e, r) => { req = r; } },
                (r) => { r((r.s = "probe_mod")); }
            ]);
            window.__wreq = req;
        }
    })()`);

    const result = await evaluate(`(() => {
        const req = window.__wreq;
        const iconMod = req(1776);
        const appStore = window.appStore;
        
        // Find 5 shortcuts that have missing icons vs working icons
        const report = [];
        for (const app of appStore.allApps) {
            if (app.app_type === 1073741824 || (app.appid >>> 0) >= 0x80000000) {
                const iconUrl = iconMod.tw.GetIconURLForApp(app);
                report.push({
                    appid: app.appid,
                    name: app.display_name,
                    bIsMod: app.BIsModOrShortcut?.(),
                    hasIconData: typeof app.icon_data !== 'undefined',
                    iconDataLen: app.icon_data?.length || 0,
                    icon_data_format: app.icon_data_format,
                    icon_hash: app.icon_hash,
                    iconUrlResult: iconUrl ? (iconUrl.slice(0, 40) + '...') : null,
                });
                if (report.length >= 20) break;
            }
        }
        return report;
    })()`);

    console.log('Shortcuts icon check:\n', JSON.stringify(result, null, 2));
    ws.close();
}

run().catch(console.error);
