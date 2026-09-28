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

    // Ensure wreq
    await evaluate(`(() => {
        if (!window.__wreq) {
            let req = null;
            window.webpackChunksteamui.push([
                ["probe_" + Date.now()],
                { probe_mod: (m, e, r) => { req = r; } },
                (r) => { r((r.s = "probe_mod")); }
            ]);
            window.__wreq = req;
        }
    })()`);

    // Call onSourceView for Animaniacs and wait for achievements to load
    const appid = 3048673328;
    const signedAppid = appid | 0;

    console.log(`Triggering view for Animaniacs (${appid} / signed: ${signedAppid})...`);
    await evaluate(`(async () => {
        // Trigger via our plugin's source view or loadAchievementsForApp directly
        const rpc = window.Millennium?.callServerMethod;
        const p = 'steam-cartridges-dev';
        const res = await rpc(p, 'CartridgesAchievementsGet', {
            shortcut_appid: ${appid},
            native_appid: 0,
            hardcore: false
        });
        return res;
    })()`);

    // Now test appDetailsStore.GetAchievements with both unsigned and signed appid!
    const state = await evaluate(`(() => {
        const store = window.appDetailsStore;
        const appStore = window.appStore;
        const overview = appStore?.GetAppOverviewByAppID?.(${appid});

        const unsignedAchievements = store?.GetAchievements?.(${appid});
        const signedAchievements = store?.GetAchievements?.(${signedAppid});

        // Test section registry GetSections
        let sectionsList = [];
        try {
            const req = window.__wreq;
            // Find sections component
            for (const [mid, mod] of Object.entries(req.m)) {
                if (mod.toString().includes('GetSections') && mod.toString().includes('postgamesummary')) {
                    const exp = req(mid);
                    const comp = exp?.Z || exp?.A || Object.values(exp).find(v => typeof v === 'function' && v.prototype?.GetSections);
                    if (comp?.prototype?.GetSections) {
                        const inst = new comp({ overview });
                        const secs = inst.GetSections(overview, {});
                        sectionsList = Array.from(secs || []);
                        break;
                    }
                }
            }
        } catch (e) {
            sectionsList = ['error: ' + e.message];
        }

        return {
            overview: {
                display_name: overview?.display_name,
                appid: overview?.appid,
                bIsMod: overview?.BIsModOrShortcut?.(),
            },
            unsignedAchievements: {
                nTotal: unsignedAchievements?.nTotal,
                nAchieved: unsignedAchievements?.nAchieved,
                sampleUnachieved: unsignedAchievements?.vecUnachieved?.slice(0, 3)?.map(a => ({ id: a.strID, name: a.strName, desc: a.strDescription }))
            },
            signedAchievements: {
                nTotal: signedAchievements?.nTotal,
                nAchieved: signedAchievements?.nAchieved,
                sampleUnachieved: signedAchievements?.vecUnachieved?.slice(0, 3)?.map(a => ({ id: a.strID, name: a.strName, desc: a.strDescription }))
            },
            sectionsList
        };
    })()`);

    console.log('Animaniacs Achievements & UI State:\n', JSON.stringify(state, null, 2));
    ws.close();
}

run().catch(console.error);
