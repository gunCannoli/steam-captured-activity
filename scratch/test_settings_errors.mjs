const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const targets = list.filter(t => t.title === 'SharedJSContext' || t.title === 'Steam');
    
    for (const target of targets) {
        console.log(`Connecting to ${target.title}...`);
        const ws = new WebSocket(target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
        await new Promise(r => ws.onopen = r);
        let id = 1;
        ws.send(JSON.stringify({ id: id++, method: 'Console.enable' }));
        ws.send(JSON.stringify({ id: id++, method: 'Log.enable' }));
        ws.send(JSON.stringify({ id: id++, method: 'Runtime.enable' }));
        
        ws.onmessage = e => {
            const m = JSON.parse(e.data);
            if (m.method === 'Runtime.consoleAPICalled') {
                const args = m.params.args?.map(a => a.value || a.description || a.type).join(' ');
                if (m.params.type === 'error' || args.includes('cartridge') || args.includes('plugin') || args.includes('setting')) {
                    console.log(`[${target.title} console.${m.params.type}]`, args);
                }
            } else if (m.method === 'Runtime.exceptionThrown') {
                console.log(`[${target.title} EXCEPTION]`, m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
            }
        };
    }

    console.log('Listening for errors... Triggering Settings navigation in Steam...');
    const shared = targets.find(t => t.title === 'SharedJSContext');
    const wsShared = new WebSocket(shared.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
    await new Promise(r => wsShared.onopen = r);
    
    // Navigate to Settings
    wsShared.send(JSON.stringify({
        id: 999,
        method: 'Runtime.evaluate',
        params: {
            expression: '(SteamClient.URL.ExecuteSteamURL("steam://open/settings"), true)'
        }
    }));

    await new Promise(r => setTimeout(r, 4000));
    console.log('Done listening.');
    process.exit(0);
}

run().catch(console.error);
