const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.title === 'SharedJSContext');
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
                const store = window.appDetailsStore;
                const a1 = store?.GetAchievements?.(3048673328);
                const a2 = store?.GetAchievements?.(3048673328 | 0);
                return {
                    unsigned: a1 ? {
                        nTotal: a1.nTotal,
                        nAchieved: a1.nAchieved,
                        vecUnachievedLen: a1.vecUnachieved?.length,
                        sample: a1.vecUnachieved?.slice(0, 3)?.map(a => a.strName)
                    } : null,
                    signed: a2 ? {
                        nTotal: a2.nTotal,
                        nAchieved: a2.nAchieved,
                        vecUnachievedLen: a2.vecUnachieved?.length,
                        sample: a2.vecUnachieved?.slice(0, 3)?.map(a => a.strName)
                    } : null
                };
            })()`,
            returnByValue: true
        }
    }));
}
run().catch(console.error);
