const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((t) => t.title === 'SharedJSContext');
    if (!target) {
        console.error('SharedJSContext not found');
        process.exit(1);
    }
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

    console.log('=== Checking Castlevania: Aria of Sorrow (3327111222) ===');
    const cvRes = await evaluate(`
        window.Millennium.callServerMethod('steam-cartridges-dev', 'CartridgesAchievementsGet', {
            payload: JSON.stringify({ shortcut_appid: 3327111222 })
        })
    `);
    const cvParsed = typeof cvRes === 'string' ? JSON.parse(cvRes) : cvRes;
    console.log('CV Ach count:', cvParsed?.schema?.achievements?.length || cvParsed?.achievements?.length, 'title:', cvParsed?.schema?.title, 'error:', cvParsed?.error);

    const cvMeta = await evaluate(`
        window.Millennium.callServerMethod('steam-cartridges-dev', 'GetGameMetadata', {
            payload: JSON.stringify({ appid: 3327111222, title: 'Castlevania - Aria of Sorrow (USA)' })
        })
    `);
    const cvMetaParsed = typeof cvMeta === 'string' ? JSON.parse(cvMeta) : cvMeta;
    console.log('CV Meta:', cvMetaParsed?.metadata?.name || cvMetaParsed?.name, 'desc:', (cvMetaParsed?.metadata?.description || cvMetaParsed?.description)?.slice(0, 80));

    console.log('=== Checking Alundra (3858889198) ===');
    const alundraRes = await evaluate(`
        window.Millennium.callServerMethod('steam-cartridges-dev', 'CartridgesAchievementsGet', {
            payload: JSON.stringify({ shortcut_appid: 3858889198 })
        })
    `);
    const alundraParsed = typeof alundraRes === 'string' ? JSON.parse(alundraRes) : alundraRes;
    console.log('Alundra Ach count:', alundraParsed?.schema?.achievements?.length || alundraParsed?.achievements?.length, 'title:', alundraParsed?.schema?.title, 'error:', alundraParsed?.error);

    const alundraMeta = await evaluate(`
        window.Millennium.callServerMethod('steam-cartridges-dev', 'GetGameMetadata', {
            payload: JSON.stringify({ appid: 3858889198, title: 'Alundra (USA)' })
        })
    `);
    const alundraMetaParsed = typeof alundraMeta === 'string' ? JSON.parse(alundraMeta) : alundraMeta;
    console.log('Alundra Meta:', alundraMetaParsed?.metadata?.name || alundraMetaParsed?.name, 'desc:', (alundraMetaParsed?.metadata?.description || alundraMetaParsed?.description)?.slice(0, 80));

    ws.close();
}

run().catch(console.error);
