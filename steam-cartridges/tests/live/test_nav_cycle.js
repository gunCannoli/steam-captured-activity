// Routine 2 (AGENTS.md): two-way navigation lifecycle, Game A -> Game B -> Game A,
// on the desktop app-details page, against a running Steam started with
// -dev -cef-enable-debugging (start-steam-dev.ps1).
//
//   node tests/live/test_nav_cycle.js [shortcutAppid] [nativeAppid]
//
// Defaults: AM2R (4263274102, a non-Steam shortcut with captures on this
// machine) and 435150 (a native game). Set SHOTS_DIR to save a screenshot per visit.
//
// Checks, on each visit to A, what non-steam-games-activity feeds on desktop:
//   - Post-Game Summary section present
//   - Recordings & screenshots count ("Manage my N recordings and screenshots")
//   - Activity feed day sections (month-day headers) and capture thumbnails
//     served from steamloopback.host (hasEvent)
// and that the second visit to A matches the first (no negative-cache blanking,
// plugins.md guardrail 5). Desktop routes in memory, so location.href never
// changes; navigation is steam://nav/games/details and readiness is read from content.

const PORT = process.env.CDP_PORT ?? '8080';
const A = Number(process.argv[2] ?? 4263274102);
const B = Number(process.argv[3] ?? 435150);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(title) {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = targets.find((t) => t.title === title || (title === 'Steam' && t.url?.includes('minwidth=1010')));
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
        async screenshot(file) {
            const m = await send('Page.captureScreenshot', { format: 'png' });
            (await import('node:fs')).writeFileSync(file, Buffer.from(m.result.data, 'base64'));
        },
        close: () => new Promise((resolve) => {
            if (ws.readyState === WebSocket.CLOSED) return resolve();
            ws.onclose = () => resolve();
            try { ws.close(); } catch { resolve(); }
            setTimeout(resolve, 500);
        }),
    };
}

// String.raw so the regex escapes (\d, \b) reach the page intact.
const METRICS = String.raw`JSON.stringify((() => {
    const text = document.body.innerText;
    const activity = text.slice(text.indexOf('ACTIVITY'), text.indexOf('Load More Activity'));
    return {
        title: document.querySelector('h1, [class*="AppName"]')?.textContent?.trim()?.slice(0, 40) ?? null,
        postGameSummary: text.includes('POST-GAME SUMMARY'),
        mediaCount: Number(text.match(/Manage my (\d+) recordings and screenshots/)?.[1] ?? 0),
        activityDays: (activity.match(/\b(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER|JAN|FEB|MAR|APR|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b[ .]*\d/g) ?? []).length,
        // Page-wide and lazily loaded, so only asserted > 0, never compared across visits.
        loopbackImages: [...document.images].filter((i) => i.src.includes('steamloopback.host')).length,
    };
})())`;

async function visit(shared, appid, label, expectText) {
    await shared.evaluate(`(SteamClient.URL.ExecuteSteamURL('steam://nav/games/details/${appid}'), true)`);
    const win = await connect('Steam');
    try {
        // Wait for the page to show the game.
        for (let i = 0; i < 30; i++) {
            if (await win.evaluate(`document.body.innerText.includes(${JSON.stringify(expectText)})`)) break;
            await wait(500);
        }
        // Then poll (max 10 s) until the shortcut's data is fed and drawn. storeDays is
        // what the plugin feeds (appActivityStore). The DOM reveals days one at a time
        // (nDaysToDisplay), so DOM day counts are never compared (guardrail 15).
        let metrics;
        for (let i = 0; i < 20; i++) {
            metrics = JSON.parse(await win.evaluate(METRICS));
            metrics.storeDays = await shared.evaluate(`appActivityStore.m_mapAppActivity.get(${appid})?.appActivityByDay?.length ?? 0`);
            if (appid !== A) break;
            if (metrics.postGameSummary && metrics.mediaCount > 0 && metrics.storeDays > 0 && metrics.activityDays > 0) break;
            await wait(500);
        }
        if (process.env.SHOTS_DIR) {
            await Promise.race([win.screenshot(`${process.env.SHOTS_DIR}/nav-${label}.png`), wait(10000)]);
        }
        return metrics;
    } finally {
        await win.close();
    }
}

const shared = await connect('SharedJSContext');
let failed = false;
try {
    const nameOf = (appid) => shared.evaluate(`window.appStore?.GetAppOverviewByAppID?.(${appid})?.display_name ?? ''`);
    const [nameA, nameB] = [await nameOf(A), await nameOf(B)];
    const first = await visit(shared, A, 'A1', nameA);
    const other = await visit(shared, B, 'B', nameB);
    const second = await visit(shared, A, 'A2', nameA);
    console.log(JSON.stringify({ first, other, second }, null, 1));

    const ok = (label, cond) => {
        console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
        if (!cond) failed = true;
    };
    ok('A: Post-Game Summary present', first.postGameSummary);
    ok('A: recordings & screenshots listed', first.mediaCount > 0);
    ok('A: activity day sections with captures (hasEvent)', first.activityDays > 0 && first.storeDays > 0 && first.loopbackImages > 0);
    ok('A (return visit): Post-Game Summary still present', second.postGameSummary);
    ok('A (return visit): same media count', second.mediaCount === first.mediaCount);
    ok('A (return visit): same activity days in the store, captures still shown', second.storeDays === first.storeDays && second.activityDays > 0 && second.loopbackImages > 0);
} finally {
    await shared.close();
}
process.exitCode = failed ? 1 : 0;
