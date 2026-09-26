// Parity gate (docs/plans/steam-cartridges-parity.md § 5): compares a non-Steam
// shortcut with the Steam data Steam itself holds for its native app, surface by
// surface, and prints PASS/FAIL per line. Read-only: it navigates the desktop
// client (A -> B -> A, Routine 2) and reads Steam's stores; it never writes
// settings, the library, collections or artwork.
//
//   node scratch/check_parity.mjs [shortcutAppid] [nativeAppid] [otherNativeAppid]
//
// Defaults: Jotunnslayer shortcut 2315502503, native 2820820, B = 435150.
// Needs Steam started with DevTools on 127.0.0.1:8080, desktop UI.
// Exit code 0 only when every line is PASS (the P5 gate).
import { existsSync } from 'node:fs';

const PORT = process.env.CDP_PORT ?? '8080';
const S = Number(process.argv[2] ?? 2315502503);
const N = Number(process.argv[3] ?? 2820820);
const B = Number(process.argv[4] ?? 435150);
const GRID = process.env.SC_GRID ?? 'C:/game/steam/userdata/83513586/config/grid';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(pred, label) {
    const t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(pred);
    if (!t) throw new Error(`No CDP target: ${label}`);
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
    let id = 0;
    const pend = new Map();
    ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        pend.get(m.id)?.(m);
        pend.delete(m.id);
    };
    const ev = (expression) =>
        new Promise((res, rej) => {
            pend.set(++id, (m) =>
                m.result?.exceptionDetails ? rej(new Error(m.result.exceptionDetails.exception?.description)) : res(m.result?.result?.value),
            );
            ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
        });
    return { ev, close: () => ws.close() };
}

const shared = await connect((t) => t.title === 'SharedJSContext', 'SharedJSContext');
const desk = await connect((t) => t.title === 'Steam' && t.url.includes('minwidth=1010'), 'desktop Steam window');
const results = [];
const check = (label, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

const HEADS = String.raw`JSON.stringify([...new Set([...document.querySelectorAll('h2, h3, [class*="SectionTitle"]')].map((e) => e.textContent.trim()).filter(Boolean))])`;
async function open(appid) {
    await shared.ev(`(SteamClient.URL.ExecuteSteamURL('steam://nav/games/details/${appid}'), true)`);
    // Poll the data signal: our sections / Steam's page heading, bounded (guardrail 15).
    for (let i = 0; i < 30; i++) {
        await wait(500);
        const heads = JSON.parse(await desk.ev(HEADS));
        if (heads.includes('Notes')) break;
    }
    await wait(1500);
}

const prev = await shared.ev(`JSON.stringify(window.MainWindowBrowserManager?.m_lastLocation?.pathname ?? null)`);
try {
    // Native data straight from Steam's StoreItemCache (loads unowned apps; P0 T3).
    const native = JSON.parse(
        await shared.ev(`(async () => {
            const c = StoreItemCache;
            const req = { include_assets: true, include_basic_info: true, include_release: true, include_full_description: true };
            if (!c.BHasApp(${N}, req)) c.QueueAppRequest(${N}, req);
            for (let i = 0; i < 30 && !c.BHasApp(${N}, req); i++) await new Promise((r) => setTimeout(r, 500));
            const it = c.GetApp(${N});
            const safe = (f) => { try { return f(); } catch { return null; } };
            return JSON.stringify(it ? {
                short: safe(() => it.GetShortDescription()),
                devs: safe(() => it.GetDeveloperNames()) ?? [],
                pubs: safe(() => it.GetPublisherNames()) ?? [],
                rel: safe(() => it.GetReleaseDateRTime()),
                orig: safe(() => it.GetOriginalReleaseDateRTime()),
                cats: [...(safe(() => it.GetStoreCategories_SupportedPlayers()) ?? []), ...(safe(() => it.GetStoreCategories_Controller()) ?? [])],
            } : null);
        })()`),
    );
    if (!native) throw new Error(`StoreItemCache has no data for ${N}`);

    // Routine 2: A -> B -> A, then read everything on the second visit.
    await open(S);
    await open(B);
    await open(S);
    await wait(3000); // the store handler resolves after the page renders; everything below polls nothing slower

    const plugin = `(PLUGIN_LIST['steam-cartridges-dev'] ?? PLUGIN_LIST['steam-cartridges'])`;
    const st = JSON.parse(
        await shared.ev(`(async () => {
            const P = ${plugin};
            const state = await P.steamStoreState();
            const ad = appDetailsStore.GetAppData(${S});
            const ov = appStore.GetAppOverviewByAppID(${S});
            const diag = P.nativeSectionsDiagnostics?.() ?? null;
            const events = (appid) => {
                const e = appActivityStore.m_mapAppActivity.get(appid);
                const out = [];
                for (const day of e?.m_mapActivityByDay?.values() ?? []) for (const ev of day.m_rgEvents ?? []) out.push(String(ev.unUniqueID ?? ev.m_gidAnnouncement ?? ''));
                return out;
            };
            return JSON.stringify({
                mapping: state.mappings?.['${S}'] ?? null,
                applied: state.applied_artwork?.['${S}'] ?? null,
                snippet: ad?.descriptionsData?.strSnippet ?? '',
                devs: (ad?.associationData?.rgDevelopers ?? []).map((d) => d.strName),
                pubs: (ad?.associationData?.rgPublishers ?? []).map((d) => d.strName),
                rel: ov?.rt_steam_release_date ?? 0,
                orig: ov?.rt_original_release_date ?? 0,
                cats: [...(ov?.m_setStoreCategories ?? [])],
                logoPosition: ad?.customImageInfo?.logoPosition ?? null,
                diag,
                nativeEvents: events(${N}),
                shortcutEvents: events(${S}),
            });
        })()`),
    );
    const heads = JSON.parse(await desk.ev(HEADS));

    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    check(`1. Steam Store match: ${S} -> ${N}`, st.mapping?.steam_appid === N, st.mapping ? `mapped to ${st.mapping.steam_appid}` : 'no mapping');
    check('2. Game Info description = native short description', !!native.short && st.snippet === native.short, st.snippet.slice(0, 50));
    check('3. Developers = native', same(st.devs, native.devs), `${st.devs.join(', ')} vs ${native.devs.join(', ')}`);
    check('4. Publishers = native', same(st.pubs, native.pubs), `${st.pubs.join(', ')} vs ${native.pubs.join(', ')}`);
    check(
        '5. Release dates = native (steam + original)',
        st.rel === native.rel && st.orig === (native.orig || native.rel),
        `${st.rel}/${st.orig} vs ${native.rel}/${native.orig}`,
    );
    const missingCats = native.cats.filter((c) => !st.cats.includes(c));
    check('6. Player + controller categories include every native one', missingCats.length === 0, missingCats.length ? `missing ${missingCats.join(',')}` : st.cats.join(','));
    const d = st.diag;
    check('7. Links use the native app', d?.lastNative?.links === N && d.counts.links > 0, d ? `links ${d.counts.links} -> ${d.lastNative.links}` : 'no nativeSectionsDiagnostics');
    const files = ['p', '_hero', '_logo', ''].map((s) => ['png', 'jpg', 'jpeg'].some((x) => existsSync(`${GRID}/${S}${s}.${x}`)));
    const slots = Array.isArray(st.applied?.slots) ? st.applied.slots : [];
    check(
        '8. Artwork: 4 slots from the match, logo positioned',
        files.every(Boolean) && st.applied?.steam_appid === N && !!st.mapping && [0, 1, 2, 3].every((s) => slots.includes(s)) && !!st.logoPosition,
        `files ${files.map(Number).join('')}, slots ${slots.join(',')}, logoPosition ${st.logoPosition ? 'set' : 'null'}`,
    );
    check('9. Friends section reads the native app', d?.lastNative?.friends === N && d.counts.friends > 0, d ? `friends ${d.counts.friends}` : 'no diagnostics');
    check(
        '10. Community Content section on desktop, native app',
        heads.some((h) => h.startsWith('Community Content')) && d?.lastNative?.community === N,
        heads.filter((h) => /Community/.test(h)).join('|') || 'no Community heading',
    );
    const missingEvents = st.nativeEvents.filter((e) => !st.shortcutEvents.includes(e));
    check(
        '11. Activity feed carries every native news/partner event',
        st.nativeEvents.length > 0 && missingEvents.length === 0,
        `native ${st.nativeEvents.length}, missing ${missingEvents.length}`,
    );
    check('12. Your Stuff media section present', heads.includes('Recordings and Screenshots'));
    check('13. Notes section present', heads.includes('Notes'));
} finally {
    const p = JSON.parse(prev ?? 'null');
    if (p) await shared.ev(`(MILLENNIUM_API.Navigation.Navigate(${JSON.stringify(p)}), true)`).catch(() => {});
    shared.close();
    desk.close();
}
const pass = results.filter(Boolean).length;
console.log(`\n${pass} PASS / ${results.length - pass} FAIL`);
process.exit(pass === results.length ? 0 : 1);
