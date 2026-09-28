const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.title === 'SharedJSContext');
    if (!target) throw new Error('SharedJSContext not found');
    const wsUrl = target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1');
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0;
    const send = (method, params = {}) => new Promise((res) => {
        const i = ++id;
        const h = (e) => {
            const m = JSON.parse(e.data);
            if (m.id === i) {
                ws.removeEventListener('message', h);
                res(m.result?.result?.value);
            }
        };
        ws.addEventListener('message', h);
        ws.send(JSON.stringify({ id: i, method, params }));
    });
    const evaluate = (expr) => send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });

    const appid = 3048673328;
    console.log(`Navigating to Animaniacs (${appid})...`);
    await evaluate(`SteamClient.URL.ExecuteSteamURL('steam://nav/games/details/${appid}')`);

    // Poll up to 10s for achievements to load
    let state = null;
    for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));
        state = await evaluate(`(() => {
            const store = window.appDetailsStore;
            const unsignedAch = store?.GetAchievements?.(${appid});
            const signedAch = store?.GetAchievements?.(${appid | 0});
            const appData = store?.GetAppData?.(${appid}) || store?.GetAppData?.(${appid | 0});

            return {
                hasAppData: Boolean(appData),
                descriptionsData: appData?.descriptionsData,
                developers: appData?.associationData?.rgDevelopers?.map(d => d.strName),
                unsignedAch: unsignedAch ? {
                    total: unsignedAch.nTotal,
                    achieved: unsignedAch.nAchieved,
                    sample: unsignedAch.vecUnachieved?.slice(0, 3)?.map(a => a.strName)
                } : null,
                signedAch: signedAch ? {
                    total: signedAch.nTotal,
                    achieved: signedAch.nAchieved,
                    sample: signedAch.vecUnachieved?.slice(0, 3)?.map(a => a.strName)
                } : null,
            };
        })()`);

        if (state?.unsignedAch && state?.descriptionsData) {
            console.log(`Loaded on attempt ${i + 1}!`);
            break;
        }
    }

    console.log('Result:\n', JSON.stringify(state, null, 2));
    ws.close();
}

run().catch(console.error);
