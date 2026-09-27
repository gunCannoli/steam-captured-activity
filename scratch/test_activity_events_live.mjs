const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.title === 'SharedJSContext');
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

    const AM2R = 4263274102;
    const result = await evaluate(`
        (async () => {
            const chunk = window.webpackChunksteamui;
            let actStore = null;
            if (chunk) {
                chunk.push([['temp_act_store_' + Math.random()], {}, (req) => {
                    const mod = req('12750');
                    actStore = mod.yX;
                }]);
            }
            if (!actStore) return { error: 'actStore not resolved' };

            const app = actStore.GetAppActivity(${AM2R});
            if (!app) return { error: 'No activity found for AM2R' };
            const days = app.appActivityByDay || [];
            return {
                daysCount: days.length,
                days: days.map(d => ({
                    dayBegin: d.m_rtDayBegin,
                    eventsCount: d.m_rgEvents?.length,
                    eventTypes: (d.m_rgEvents || []).map(e => e.eEventType)
                }))
            };
        })()
    `);

    console.log('Current AM2R Activity days:', JSON.stringify(result, null, 2));

    ws.close();
}

run();
