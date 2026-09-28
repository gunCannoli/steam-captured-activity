const PORT = '8080';
const A = 3048673328; // Animaniacs
const B = 435150;     // Native game

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

    async function checkState(label) {
        let st = null;
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 500));
            st = await evaluate(`(() => {
                const store = window.appDetailsStore;
                const a = store?.GetAchievements?.(${A});
                const appData = store?.GetAppData?.(${A}) || store?.GetAppData?.(${A | 0});
                return {
                    label: '${label}',
                    hasAppData: Boolean(appData),
                    hasDescriptions: Boolean(appData?.descriptionsData?.strSnippet),
                    nTotal: a?.nTotal,
                    nAchieved: a?.nAchieved,
                    hasBadges: Boolean(a?.vecUnachieved?.[0]?.strImage?.includes('retroachievements'))
                };
            })()`);
            if (st?.nTotal > 0 && st?.hasDescriptions) break;
        }
        return st;
    }

    console.log('1. Navigating to Animaniacs...');
    await evaluate(`SteamClient.URL.ExecuteSteamURL('steam://nav/games/details/${A}')`);
    const st1 = await checkState('Visit 1');
    console.log('State 1:', st1);

    console.log('2. Navigating to Native game...');
    await evaluate(`SteamClient.URL.ExecuteSteamURL('steam://nav/games/details/${B}')`);
    await new Promise(r => setTimeout(r, 1500));

    console.log('3. Navigating back to Animaniacs...');
    await evaluate(`SteamClient.URL.ExecuteSteamURL('steam://nav/games/details/${A}')`);
    const st2 = await checkState('Visit 2');
    console.log('State 2:', st2);

    const ok = (st1?.nTotal === 98 && st2?.nTotal === 98 && st1?.hasDescriptions && st2?.hasDescriptions);
    console.log(ok ? 'PASS: Two-way navigation preserved Animaniacs achievements & metadata!' : 'FAIL');
    ws.close();
    process.exitCode = ok ? 0 : 1;
}

run().catch(console.error);
