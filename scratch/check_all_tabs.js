// Routine 1 (AGENTS.md): verify all four core views for a non-Steam shortcut in
// Big Picture, plus a Big Picture A -> B -> A pass (Routine 2), against a running
// Steam started with -dev -cef-enable-debugging. Opens Big Picture if needed.
//
//   node scratch/check_all_tabs.js [shortcutAppid] [nativeAppid]
//
// Defaults: AM2R (4263274102) and 435150. Views checked:
//   1. Post-Game Summary       - "Post-Game Summary" section on the Activity tab
//   2. Activity feed           - "{Username} captured" day cards (hasEvent)
//   3. Your Stuff              - Media section with an item count (not the empty placeholder)
//   4. Game Info               - description + developer + release date, no grey shortcut warning

const PORT = process.env.CDP_PORT ?? '8080';
const A = Number(process.argv[2] ?? 4263274102);
const B = Number(process.argv[3] ?? 435150);
const BPM = 'Steam Big Picture Mode';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
    return (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
}

async function connect(title) {
    const target = (await targets()).find((t) => t.title === title);
    if (!target) throw new Error(`No CDP target "${title}"`);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
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
    return {
        async evaluate(expression) {
            const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
            if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description);
            return m.result?.result?.value;
        },
        close: () => ws.close(),
    };
}

const VIEW = String.raw`JSON.stringify((() => {
    const t = document.body.innerText;
    return {
        postGameSummary: t.includes('Post-Game Summary'),
        captured: (t.match(/ captured/g) ?? []).length,
        media: Number(t.match(/Manage my (\d+) items/)?.[1] ?? 0),
        description: (t.match(/GAME INFO\s+([^\n]{40,})/)?.[1] ?? '').slice(0, 60),
        developer: /DEVELOPER|Developer/.test(t),
        releaseDate: /RELEASE DATE|Release Date/.test(t),
        errorBoundary: t.includes('An error occurred while rendering this content'),
        shortcutWarning: /detailed information on .* is unavailable/i.test(t),
    };
})())`;

async function view(shared, path, expect) {
    await shared.evaluate(`(window.MILLENNIUM_API.Navigation.Navigate(${JSON.stringify(path)}), true)`);
    const win = await connect(BPM);
    try {
        for (let i = 0; i < 20; i++) {
            if (await win.evaluate(`document.body.innerText.includes(${JSON.stringify(expect)})`)) break;
            await wait(500);
        }
        await wait(2500); // async store feeding
        return JSON.parse(await win.evaluate(VIEW));
    } finally {
        win.close();
    }
}

const shared = await connect('SharedJSContext');
let failed = false;
const ok = (label, cond, detail) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail !== undefined ? `  (${JSON.stringify(detail)})` : ''}`);
    if (!cond) failed = true;
};

try {
    if (!(await targets()).some((t) => t.title === BPM)) {
        await shared.evaluate(`(SteamClient.URL.ExecuteSteamURL('steam://open/bigpicture'), true)`);
        for (let i = 0; i < 30 && !(await targets()).some((t) => t.title === BPM); i++) await wait(1000);
    }
    const name = (appid) => shared.evaluate(`window.appStore?.GetAppOverviewByAppID?.(${appid})?.display_name ?? ''`);
    const [nameA, nameB] = [await name(A), await name(B)];

    const activity = await view(shared, `/library/app/${A}`, nameA);
    ok('1. Post-Game Summary', activity.postGameSummary);
    ok('2. Activity feed: "{Username} captured" cards (hasEvent)', activity.captured > 0, activity.captured);

    const stuff = await view(shared, `/library/app/${A}/tab/YourStuff`, 'Media');
    ok('3. Your Stuff: media items', stuff.media > 0, stuff.media);

    const info = await view(shared, `/library/app/${A}/tab/GameInfo`, nameA);
    ok('4. Game Info: no error boundary', !info.errorBoundary);
    const bucket = await shared.evaluate(`PLUGIN_LIST['steam-cartridges-dev'].bucketReport().games[${A}]?.bucket ?? 'none'`);
    if (bucket === 'web-scraping' || bucket === 'steam-store') {
        console.log(`INFO  check 4 branch: ${bucket} (expect enrichment)`);
        ok('4. Game Info: description, developer, release date', !!info.description && info.developer && info.releaseDate, info.description);
        ok('4. Game Info: no grey shortcut warning', !info.shortcutWarning);
    } else {
        console.log('INFO  check 4 branch: none (grey shortcut warning accepted)');
    }
    ok('collectionStore health: userCollections readable', (await shared.evaluate('(() => { try { return Array.isArray(collectionStore.userCollections) } catch { return false } })()')) === true);

    const infoB = await view(shared, `/library/app/${B}/tab/GameInfo`, nameB);
    ok('Native B Game Info: no error boundary', !infoB.errorBoundary);
    await view(shared, `/library/app/${B}`, nameB);
    let back;
    for (let i = 0; i < 20; i++) {
        back = await view(shared, `/library/app/${A}`, nameA);
        if (back.captured >= 1 && back.captured === activity.captured) break;
        await wait(500);
    }
    ok('A -> B -> A: Post-Game Summary intact', back.postGameSummary);
    ok('A -> B -> A: no error boundary', !back.errorBoundary);
    ok('A -> B -> A: activity cards intact (hasEvent)', back.captured >= 1 && back.captured === activity.captured, back.captured);
} finally {
    shared.close();
}
process.exitCode = failed ? 1 : 0;
