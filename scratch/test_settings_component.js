// Render SettingsPanel in SharedJSContext to verify no React errors occur
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
        if (r.result?.exceptionDetails) {
            throw new Error(r.result.exceptionDetails.text + ' ' + JSON.stringify(r.result.exceptionDetails.exception));
        }
        return r.result?.result?.value;
    };

    console.log('Testing SettingsPanel component mounting in SharedJSContext...');
    const result = await evaluate(`
        (async () => {
            try {
                // Find webpack chunk
                let reactDOM = window.__testReactDOM;
                if (!reactDOM && window.webpackChunksteamui) {
                    const chunkId = 'dummy_' + Math.random().toString(36).slice(2);
                    window.webpackChunksteamui.push([[chunkId], {}, (req) => {
                        for (const id of Object.keys(req.m)) {
                            try {
                                const mod = req(id);
                                if (mod?.createRoot || mod?.default?.createRoot) {
                                    reactDOM = mod?.createRoot ? mod : mod.default;
                                    window.__testReactDOM = reactDOM;
                                    break;
                                }
                            } catch (_) {}
                        }
                    }]);
                }

                if (!reactDOM) return { hasReactDOM: false };

                // Render into container
                const container = document.createElement('div');
                const root = reactDOM.createRoot(container);
                const nav = window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS['steam-cartridges-dev'];
                
                // Mount
                root.render(nav.content);
                await new Promise(r => setTimeout(r, 100));

                const sections = Array.from(container.querySelectorAll('.PanelSectionTitle, ._1IigUZ3GHaZS2Y-3V3T2rT'))
                    .map(el => el.textContent?.trim());

                return {
                    hasReactDOM: true,
                    sections,
                    totalButtons: container.querySelectorAll('button').length,
                    totalFields: container.querySelectorAll('.DialogBodyText, input, [role="button"]').length,
                };
            } catch (err) {
                return { error: String(err), stack: err?.stack };
            }
        })()
    `);
    console.log('Render check:', JSON.stringify(result, null, 2));

    ws.close();
}

run().catch((e) => {
    console.error('Error:', e);
    process.exit(1);
});
