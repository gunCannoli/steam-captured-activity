const PORT = '8080';

const GAMES = [
    { appid: 4227770158, name: "E. V. O.: Search for Eden", expectedWord: "Evolution" },
    { appid: 2211260352, name: "Mother 1 + 2", expectedWord: "Mother" },
    { appid: 2173025092, name: "Donkey Kong Country 3", expectedWord: "Dixie" },
    { appid: 2943105341, name: "Prince of Persia", expectedWord: "hourglass" },
    { appid: 4276481436, name: "Patrick Star in Mario Kart", expectedWord: "Mario" },
];

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.title === 'SharedJSContext');
    const ws = new WebSocket(target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
    await new Promise(r => ws.onopen = r);
    const send = (method, params = {}) => new Promise(res => {
        const id = Math.floor(Math.random() * 100000);
        const h = e => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener('message', h); res(m.result?.result?.value); } };
        ws.addEventListener('message', h);
        ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = (expr) => send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });

    for (const g of GAMES) {
        console.log(`Navigating to ${g.name} (${g.appid})...`);
        await evaluate(`SteamClient.URL.ExecuteSteamURL('steam://nav/games/details/${g.appid}')`);
        let ok = false;
        for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 400));
            const appData = await evaluate(`(() => {
                const s = window.appDetailsStore;
                const d = s?.GetAppData?.(${g.appid}) || s?.GetAppData?.(${g.appid | 0});
                return {
                    snippet: d?.descriptionsData?.strSnippet,
                    devs: d?.associationData?.rgDevelopers?.map(x => x.strName)
                };
            })()`);
            if (appData?.snippet && appData.snippet.includes(g.expectedWord)) {
                console.log(`  PASS: Found snippet ("${appData.snippet.slice(0, 50)}...") devs: ${JSON.stringify(appData.devs)}`);
                ok = true;
                break;
            }
        }
        if (!ok) console.log(`  FAIL for ${g.name}`);
    }

    ws.close();
}

run().catch(console.error);
