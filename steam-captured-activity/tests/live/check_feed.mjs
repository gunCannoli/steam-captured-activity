// Live check of steam-captured-activity against the running client (127.0.0.1:8080, the -dev plugin deployed).
// Hold the Steam lock while it runs (AGENTS.md Routine 0): it navigates pages.
//
//   node tests/live/check_feed.mjs [steamAppid] [shortcutAppid]
//
// Defaults: 435150 (a Steam game with local screenshots and a clip on this machine) and AM2R (4263274102, a shortcut).
// Pick a Steam game that has captures in userdata/<user>/760/remote/<appid>/screenshots.
//   1. Each page shows "{Username} captured" cards, and Steam's store holds our events.
//   2. A -> B -> A: both feeds intact, Steam's own events in A's entry untouched.
//   3. Clean-up: Steam's screenshot list is made to omit A's oldest screenshot (nothing on disk is touched), the sweep
//      runs, and A's feed loses exactly that capture; the list is restored, the sweep runs, and it comes back.
// Works in desktop and Big Picture (whichever window is open).

const PORT = 8080;
const A = Number(process.argv[2] ?? 435150);
const B = Number(process.argv[3] ?? 4263274102);
const PLUGIN = "steam-captured-activity-dev";
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
            const m = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
            if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description);
            return m.result?.result?.value;
        },
        close: () => {
            try {
                ws.close();
            } catch {}
        },
    };
}

/** Our events and Steam's in an app's activity entry. */
const STORE = (appid) => `(() => {
    const e = window.appActivityStore?.m_mapAppActivity?.get(${appid});
    if (!e) return null;
    let ours = 0, other = 0, items = 0;
    for (const d of e.m_mapActivityByDay.values())
        for (const ev of [...(d.m_rgEvents ?? [])]) {
            if (ev?.__capturedActivity) { ours++; items += ev.m_mediaItems.length; } else other++;
        }
    return { ours, other, items, days: e.appActivityByDay?.length ?? 0 };
})()`;

const TEXT = String.raw`JSON.stringify({
    captured: (document.body.innerText.match(/ captured/g) ?? []).length,
    errorBoundary: document.body.innerText.includes('An error occurred while rendering this content'),
})`;

let failed = false;
const ok = (label, cond, detail) => {
    console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail !== undefined ? `  (${JSON.stringify(detail)})` : ""}`);
    if (!cond) failed = true;
};

const shared = await connect("SharedJSContext");
const windowTitle = async () => {
    const list = await targets();
    if (list.some((t) => t.title === "Steam Big Picture Mode")) return "Steam Big Picture Mode";
    if (list.some((t) => t.title === "Steam")) return "Steam";
    throw new Error("No Steam window (desktop or Big Picture) to read");
};

/** Open a page, then poll the store until our events are there (guardrail 15: the data signal, not a fixed wait). */
async function open(appid) {
    await shared.evaluate(`(window.MILLENNIUM_API.Navigation.Navigate("/library/app/${appid}"), true)`);
    let store = null;
    for (let i = 0; i < 30; i++) {
        await wait(500);
        store = await shared.evaluate(STORE(appid));
        if (store?.ours > 0) break;
    }
    let text = { captured: 0, errorBoundary: false };
    const win = await connect(await windowTitle());
    try {
        for (let i = 0; i < 20; i++) {
            text = JSON.parse(await win.evaluate(TEXT));
            if (text.captured > 0) break;
            await wait(500);
        }
    } finally {
        win.close();
    }
    return { store, text };
}

try {
    const loaded = await shared.evaluate(`!!window.PLUGIN_LIST?.["${PLUGIN}"]?.diagnostics`);
    ok(`${PLUGIN} loaded`, loaded);
    const mode = await shared.evaluate(`SteamClient.UI.GetUIMode?.()`).catch(() => undefined);
    console.log(`INFO  UI mode ${mode} (7 desktop, 4 Big Picture); window: ${await windowTitle()}`);

    const a1 = await open(A);
    ok(`A ${A}: "captured" cards on the page`, a1.text.captured > 0 && !a1.text.errorBoundary, a1.text);
    ok(`A ${A}: our events in Steam's store`, (a1.store?.ours ?? 0) > 0, a1.store);
    const b1 = await open(B);
    ok(`B ${B}: "captured" cards on the page`, b1.text.captured > 0 && !b1.text.errorBoundary, b1.text);
    ok(`B ${B}: our events in Steam's store`, (b1.store?.ours ?? 0) > 0, b1.store);
    const a2 = await open(A);
    ok("A -> B -> A: A's captures intact", a2.store?.items === a1.store?.items && a2.text.captured > 0, { before: a1.store, after: a2.store });
    ok("A -> B -> A: Steam's own events in A's entry untouched", (a2.store?.other ?? 0) >= (a1.store?.other ?? 0), { before: a1.store?.other, after: a2.store?.other });

    // Clean-up: hide A's oldest screenshot from Steam's list (in memory only), sweep, check, restore, sweep.
    const hidden = await shared.evaluate(`(async () => {
        const apps = SteamClient.Apps;
        // Every page (Steam answers the newest 100; the next page ends before the oldest one), then the oldest of all:
        // hiding it keeps every page but the last full, as a real deletion does.
        const list = [];
        for (let end = 0, i = 0; i < 20; i++) {
            const page = await apps.GetScreenshotsInTimeRange(${A}, 0, end);
            list.push(...page);
            if (page.length < 100) break;
            end = Math.min(...page.map((s) => s.nCreated)) - 1;
        }
        if (!list.length) return null;
        const hiddenShot = [...list].sort((x, y) => x.nCreated - y.nCreated)[0];
        window.__sca_original_shots = apps.GetScreenshotsInTimeRange;
        apps.GetScreenshotsInTimeRange = async function (appid, a, b) {
            const r = await window.__sca_original_shots.call(this, appid, a, b);
            return appid === ${A} ? r.filter((s) => s.hHandle !== hiddenShot.hHandle) : r;
        };
        return hiddenShot.hHandle;
    })()`);
    if (hidden === null) {
        console.log(`SKIP  clean-up: ${A} has no screenshots in Steam's list`);
    } else {
        try {
            await shared.evaluate(`window.PLUGIN_LIST["${PLUGIN}"].sweepNow()`);
            const after = await shared.evaluate(STORE(A));
            ok("clean-up: a capture Steam no longer lists leaves the feed", after?.items === a2.store.items - 1, { before: a2.store.items, after: after?.items });
            ok("clean-up: Steam's own events stay", after?.other === a2.store.other, { before: a2.store.other, after: after?.other });
        } finally {
            await shared.evaluate(`(SteamClient.Apps.GetScreenshotsInTimeRange = window.__sca_original_shots, delete window.__sca_original_shots, true)`);
        }
        await shared.evaluate(`window.PLUGIN_LIST["${PLUGIN}"].sweepNow()`);
        const restored = await shared.evaluate(STORE(A));
        ok("clean-up: restored when Steam lists it again", restored?.items === a2.store.items, { expected: a2.store.items, got: restored?.items });
    }
    const diag = await shared.evaluate(`window.PLUGIN_LIST["${PLUGIN}"].diagnostics()`);
    ok("no part switched off by its error budget", (diag?.safety?.tripped ?? []).length === 0, diag?.safety);
} finally {
    shared.close();
}
process.exitCode = failed ? 1 : 0;
