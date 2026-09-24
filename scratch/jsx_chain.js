// Diagnose the shared react/jsx-runtime patch chain (steam/jsx-hook.ts in
// non-steam-games-activity and enhanced-achievements) against a running Steam (-dev).
//
//   node scratch/jsx_chain.js [steadySeconds=60]
//
// Scenarios, each printed as PASS/FAIL with the evidence:
//   1. Steady state: chain depth stable, 1 install per plugin, all live.
//   2. Foreign (non-SDK) wrapper on top: plugins stay live via the sentinel probe,
//      no re-install, and the chain does not grow.
//   3. Reference dropped (base jsx restored): every plugin re-installs within one interval.
//   4. Function: the enhanced-achievements banner still renders on a test achievement.

const PORT = process.env.CDP_PORT ?? '8080';
const STEADY = Number(process.argv[2] ?? 60);
const PLUGINS = ['steam-cartridges-dev', 'enhanced-achievements-dev'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(title) {
    const target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.title === title);
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
    return {
        async evaluate(expression) {
            const m = await new Promise((res) => {
                pending.set(++id, res);
                ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
            });
            if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description);
            return m.result?.result?.value;
        },
        close: () => ws.close(),
    };
}

let failed = false;
const ok = (label, cond, detail) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
    if (!cond) failed = true;
};

const s = await connect('SharedJSContext');

/** Snapshot: SDK-link depth of the whole chain + each plugin's diagnostics. */
const snapshot = async () =>
    JSON.parse(
        await s.evaluate(`JSON.stringify((() => {
            const rt = window.MILLENNIUM_API.findModuleByExport((e, n) => (n === 'jsx' || n === 'jsxs') && typeof e === 'function');
            const depth = (f) => { let d = 0; while (f && f.__millenniumPatch?.original && d < 200) { f = f.__millenniumPatch.original; d++; } return d; };
            const diagKeys = ['jsxDiagnostics', 'headlineJsxDiagnostics', 'activityCardsJsxDiagnostics'];
            const plugins = {};
            for (const p of ${JSON.stringify(PLUGINS)}) {
                const mod = window.PLUGIN_LIST?.[p];
                const fns = diagKeys.map((k) => mod?.[k]).filter((fn) => typeof fn === 'function');
                plugins[p] = fns.length ? fns.flatMap((fn) => fn()) : 'no jsxDiagnostics export (not deployed?)';
            }
            return { jsxLinks: depth(rt.jsx), jsxsLinks: depth(rt.jsxs), plugins };
        })())`),
    );

const installs = (snap) =>
    Object.fromEntries(Object.entries(snap.plugins).map(([p, d]) => [p, Array.isArray(d) ? d.map((x) => `${x.label.split('.').pop()}:${x.installs}${x.live ? '' : '(DEAD)'}`).join(' ') : d]));

try {
    // 1. Steady state
    const samples = [];
    for (let t = 0; t <= STEADY; t += 5) {
        samples.push(await snapshot());
        if (t < STEADY) await wait(5000);
    }
    const first = samples[0], last = samples.at(-1);
    console.log('first:', JSON.stringify({ links: [first.jsxLinks, first.jsxsLinks], installs: installs(first) }));
    console.log('last: ', JSON.stringify({ links: [last.jsxLinks, last.jsxsLinks], installs: installs(last) }));
    const allDiag = (snap) => Object.values(snap.plugins).flat();
    ok('1. plugins expose diagnostics', allDiag(last).every((d) => typeof d === 'object'), installs(last));
    ok(`1. chain depth stable over ${STEADY}s`, samples.every((x) => x.jsxLinks === first.jsxLinks && x.jsxsLinks === first.jsxsLinks), samples.map((x) => x.jsxLinks));
    ok('1. every patch live', allDiag(last).every((d) => d.live));
    ok('1. no re-installs in steady state', allDiag(last).every((d) => d.installs === allDiag(first).find((f) => f.label === d.label)?.installs));

    // 2. Foreign wrapper on top
    await s.evaluate(`(() => {
        const rt = window.MILLENNIUM_API.findModuleByExport((e, n) => (n === 'jsx' || n === 'jsxs') && typeof e === 'function');
        window.__foreign = { jsx: rt.jsx, jsxs: rt.jsxs };
        rt.jsx = function foreignJsx(...a) { return window.__foreign.jsx.apply(this, a); };
        rt.jsxs = function foreignJsxs(...a) { return window.__foreign.jsxs.apply(this, a); };
        return true;
    })()`);
    const beforeForeign = await snapshot();
    await wait(12000);
    const afterForeign = await snapshot();
    ok('2. foreign wrapper: still live (probe)', allDiag(afterForeign).every((d) => d.live && d.probed), installs(afterForeign));
    ok('2. foreign wrapper: no re-install', allDiag(afterForeign).every((d) => d.installs === allDiag(beforeForeign).find((f) => f.label === d.label)?.installs));
    await s.evaluate(`(() => {
        const rt = window.MILLENNIUM_API.findModuleByExport((e, n) => (n === 'jsx' || n === 'jsxs') && typeof e === 'function');
        rt.jsx = window.__foreign.jsx; rt.jsxs = window.__foreign.jsxs; delete window.__foreign; return true;
    })()`);

    // 3. Reference dropped: restore the base jsx (bottom of the SDK chain)
    const beforeDrop = await snapshot();
    await s.evaluate(`(() => {
        const rt = window.MILLENNIUM_API.findModuleByExport((e, n) => (n === 'jsx' || n === 'jsxs') && typeof e === 'function');
        const base = (f) => { while (f.__millenniumPatch?.original) f = f.__millenniumPatch.original; return f; };
        rt.jsx = base(rt.jsx); rt.jsxs = base(rt.jsxs); return true;
    })()`);
    await wait(7000);
    const afterDrop = await snapshot();
    ok('3. dropped reference: every plugin re-installed once', allDiag(afterDrop).every((d) => d.live && d.installs === allDiag(beforeDrop).find((f) => f.label === d.label)?.installs + 1), installs(afterDrop));
    ok('3. dropped reference: chain rebuilt to the same depth', afterDrop.jsxLinks === beforeDrop.jsxLinks, [beforeDrop.jsxLinks, afterDrop.jsxLinks]);

    // 4. Function: banner still renders
    await wait(3000);
    await s.evaluate(`window.NotificationStore.TestAchievement(480).then(() => true)`);
    let toast;
    for (let i = 0; i < 12 && !toast; i++) {
        await wait(500);
        toast = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => /^notificationtoasts/.test(t.title));
    }
    await wait(600);
    const w = toast && (await connect(toast.title));
    ok('4. achievement banner renders after all of the above', !!w && (await w.evaluate(`!!document.querySelector('.ea-banner')`)));
    w?.close();
} catch (error) {
    console.log('ERROR', error.message);
    failed = true;
} finally {
    s.close();
}
process.exitCode = failed ? 1 : 0;
