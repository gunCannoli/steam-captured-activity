const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.title === 'SharedJSContext');
    const ws = new WebSocket(target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
    await new Promise(r => ws.onopen = r);
    let id = 1;
    ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        const val = m.result?.result?.value;
        try {
            const parsed = JSON.parse(val);
            console.log('Schema title:', parsed?.schema?.title);
            console.log('Achievements total:', parsed?.schema?.total);
            console.log('Achievements array len:', parsed?.schema?.achievements?.length);
            console.log('First 2 achievements:', parsed?.schema?.achievements?.slice(0, 2));
            console.log('Unlocks:', parsed?.unlocks);
        } catch {
            console.log('Raw result:', val);
        }
        ws.close();
    };
    ws.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: {
            expression: `(async () => {
                return window.Millennium.callServerMethod('steam-cartridges-dev', 'CartridgesAchievementsGet', {
                    payload: JSON.stringify({ shortcut_appid: 3048673328, native_appid: 0, hardcore: false })
                });
            })()`,
            awaitPromise: true,
            returnByValue: true
        }
    }));
}
run().catch(console.error);
