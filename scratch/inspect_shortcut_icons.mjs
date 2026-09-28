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
        const appid = 3048673328;
        const o = window.appStore?.GetAppOverviewByAppID?.(appid);
        const proto = o ? Object.getPrototypeOf(o) : null;
        
        // Find a few non-steam shortcuts
        const allShortcuts = [];
        if (window.appStore?.allApps) {
            for (const app of window.appStore.allApps) {
                if (app.app_type === 1073741824 || app.BIsModOrShortcut?.()) {
                    allShortcuts.push({
                        appid: app.appid,
                        name: app.display_name,
                        icon_data: app.icon_data?.slice(0, 30),
                        icon_data_format: app.icon_data_format,
                        icon_hash: app.icon_hash,
                        hasIconURL: Boolean(app.GetIconURL?.()),
                        iconURL: app.GetIconURL?.(),
                        bIsMod: app.BIsModOrShortcut?.(),
                    });
                }
                if (allShortcuts.length >= 10) break;
            }
        }

        const native = window.appStore?.GetAppOverviewByAppID?.(435150);
        return {
            animaniacs: {
                display_name: o?.display_name,
                icon_data: o?.icon_data?.slice(0, 30),
                icon_data_format: o?.icon_data_format,
                icon_hash: o?.icon_hash,
                app_type: o?.app_type,
                m_gameid: o?.m_gameid,
                bIsMod: o?.BIsModOrShortcut?.(),
                iconURL: o?.GetIconURL?.(),
            },
            nativeGame: {
                display_name: native?.display_name,
                icon_data: native?.icon_data?.slice(0, 30),
                icon_data_format: native?.icon_data_format,
                icon_hash: native?.icon_hash,
                iconURL: native?.GetIconURL?.(),
            },
            getIconURLSource: proto?.GetIconURL?.toString(),
            sampleShortcuts: allShortcuts,
        };
    })()`);

    console.log('Result:', JSON.stringify(res, null, 2));
    ws.close();
}

run().catch(console.error);
