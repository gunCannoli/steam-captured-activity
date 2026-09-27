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

    const AM2R = 4263274102;
    console.log('Testing synthetic ReceivedNewGame and PlayedGameFirstTime events on AM2R...');
    const result = await evaluate(`
        (async () => {
            const chunk = window.webpackChunksteamui;
            let actStore, storeCache, friendStore;
            if (chunk) {
                chunk.push([['temp_act_test_' + Math.random()], {}, (req) => {
                    actStore = req('12750')?.yX;
                    storeCache = req('85688')?.A;
                    friendStore = req('35198')?.O$;
                }]);
            }

            if (!actStore || !storeCache) return { error: 'Stores not found' };

            const currentSteamID = friendStore?.currentUserSteamID;
            const app = actStore.GetOrCreateAppActivity(${AM2R});
            
            // Ensure fake StoreItem exists
            let fakeApp = storeCache.m_mapApps.get(${AM2R});
            if (!fakeApp) {
                fakeApp = {
                    m_unID: ${AM2R},
                    m_unAppID: ${AM2R},
                    m_bVisible: true,
                    m_strName: "AM2R: Return of Samus",
                    m_eItemType: 0,
                    m_eAppType: 1,
                    m_rgStoreTags: [],
                    m_rgStoreTagIDs: [],
                    m_DataRequested: { include_assets: true, include_platforms: true, include_release: true },
                    BIsVisible: () => true,
                    BIsApplicationOrTool: () => false,
                    GetName: () => "AM2R: Return of Samus",
                    GetAssets: () => ({ GetCommunityIconURL: () => "" }),
                    BContainDataRequest: () => true
                };
                storeCache.m_mapApps.set(${AM2R}, fakeApp);
            }

            const now = Math.floor(Date.now() / 1000);
            const midnight = new Date();
            midnight.setHours(0,0,0,0);
            const dayBegin = Math.floor(midnight.getTime() / 1000);

            // Get or create day
            let day = app.m_mapActivityByDay.get(dayBegin);
            if (!day) {
                // sample Day constructor
                const sample = actStore.m_mapAppActivity.values().next()?.value?.appActivityByDay?.[0];
                const CDay = sample?.constructor;
                if (CDay) {
                    day = new CDay();
                    day.m_rtDayBegin = dayBegin;
                    app.m_mapActivityByDay.set(dayBegin, day);
                }
            }

            if (!day) return { error: 'Could not create day' };

            // Create event 3: ReceivedNewGame
            const addedEvent = {
                eEventType: 3,
                appid: ${AM2R},
                gameid: "${AM2R}",
                rtEventTime: now - 3600,
                steamIDActor: currentSteamID,
                steamIDTarget: currentSteamID,
                bIsNonSteam: true,
                BIsValid: () => true,
                GetFilteredAppIds: () => [${AM2R}],
                commentThreads: [],
                activeThread: 0,
                GetActiveCommentThread: () => null,
                GetParentalFeature: () => 0,
                BSupportsCommentThreads: () => false
            };

            // Create event 30: PlayedGameFirstTime
            const playedEvent = {
                eEventType: 30,
                appid: ${AM2R},
                gameid: "${AM2R}",
                rtEventTime: now - 1800,
                steamIDActor: currentSteamID,
                steamIDTarget: currentSteamID,
                bIsNonSteam: true,
                BIsValid: () => true,
                BIsApplicationOrTool: () => false,
                commentThreads: [],
                activeThread: 0,
                GetActiveCommentThread: () => null,
                GetParentalFeature: () => 0,
                BSupportsCommentThreads: () => false
            };

            day.m_rgEvents.push(addedEvent);
            day.m_rgEvents.push(playedEvent);

            return {
                success: true,
                dayEventsCount: day.m_rgEvents.length,
                eventTypes: day.m_rgEvents.map(e => e.eEventType)
            };
        })()
    `);

    console.log('Synthetic test result:', JSON.stringify(result, null, 2));

    ws.close();
}

run();
