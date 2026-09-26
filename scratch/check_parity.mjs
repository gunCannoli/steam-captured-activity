// Parity gate (docs/plans/steam-cartridges-parity.md § 6): compares a non-Steam
// shortcut with the Steam data Steam itself holds for its native app, surface by
// surface, and prints PASS/FAIL per line. Read-only: it navigates the desktop
// client (A -> B -> A, Routine 2; check 16 opens and closes one news overlay the
// way a click does) and reads Steam's stores; it never writes settings, the
// library, collections or artwork.
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

// Badge policy (ADR-0038; same lists as frontend/features/game-info/category-policy.ts).
const ALLOWED_CATEGORIES = [1, 2, 9, 20, 24, 27, 36, 37, 38, 39, 49, 18, 28, 55, 56, 57, 58];
const STEAM_ONLY_CATEGORIES = [22, 23, 29, 30, 42, 43, 44, 59, 62];

// Links bar entries on the desktop page: the props Steam's link component gets (url, or link id + appid).
const LINKS = String.raw`JSON.stringify([...document.querySelectorAll('[role="link"]')].map((el) => {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    let f = key ? el[key] : null;
    for (let i = 0; f && i < 6; i++, f = f.return) {
        const p = f.memoizedProps;
        if (p && typeof p.label === 'string' && ('url' in p || 'link' in p)) return { label: p.label, url: p.url ?? null, link: p.link ?? null, appid: p.appid ?? null };
    }
    return null;
}).filter(Boolean))`;

// The appid Steam's Community Content loader fetches for (its own state, not ours).
const COMMUNITY_LOADER = String.raw`(() => {
    const el = document.querySelector('[class*="CommunityContentContainer"]');
    const key = el && Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    for (let f = key ? el[key] : null, i = 0; f && i < 12; i++, f = f.return) {
        const loader = f.stateNode && f.stateNode.m_loader;
        if (loader && 'm_unAppID' in loader) return JSON.stringify(loader.m_unAppID);
    }
    return 'null';
})()`;

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
            // Event identity: unUniqueID is a per-store counter (the native news event is 1), so key
            // news by its announcement GID and anything else by type, time, actor and id.
            const events = (appid) => {
                const e = appActivityStore.m_mapAppActivity.get(appid);
                const out = [];
                for (const day of e?.m_mapActivityByDay?.values() ?? []) for (const ev of day.m_rgEvents ?? []) {
                    const actor = ev.steamIDActor?.ConvertTo64BitString?.() ?? '';
                    out.push(ev.announcementGID ? 'news:' + ev.announcementGID : [ev.eEventType, ev.rtEventTime, actor, ev.unUniqueID].join(':'));
                }
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
                denied: ${JSON.stringify(STEAM_ONLY_CATEGORIES)}.filter((id) => ov?.m_setStoreCategories?.has(id) || ov?.BHasStoreCategory?.(id)),
                notAllowed: [...(ov?.m_setStoreCategories ?? [])].filter((id) => !${JSON.stringify(ALLOWED_CATEGORIES)}.includes(id)),
                diag,
                nativeEvents: events(${N}),
                shortcutEvents: events(${S}),
            });
        })()`),
    );
    const heads = JSON.parse(await desk.ev(HEADS));
    const links = JSON.parse(await desk.ev(LINKS));
    const linkUrls = JSON.parse(await shared.ev(`JSON.stringify(${JSON.stringify(links)}.map((l) => l.url || urlStore.ResolveURL(l.link, l.appid) || ''))`));
    const communityAppid = JSON.parse(await desk.ev(COMMUNITY_LOADER));

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
    check(
        '14. Badges: no Steam-only category, only allowed ones (ADR-0038)',
        st.cats.length > 0 && st.denied.length === 0 && st.notAllowed.length === 0,
        `categories ${st.cats.join(',') || 'none'}; Steam-only ${st.denied.join(',') || 'none'}; not allowed ${st.notAllowed.join(',') || 'none'}`,
    );
    const toNative = (u) => (u.includes(`/app/${N}`) || u.includes(`appid=${N}`)) && !u.includes(String(S));
    const linkIds = new Set(links.map((l) => l.link).filter(Boolean));
    const needIds = ['GameHub', 'GameHubDiscussions', 'GameHubGuides', 'HelpAppPage'];
    check(
        '15. Header links (Store Page, Community Hub, Discussions, Guides, Support) open the native app',
        linkUrls.length > 0 && linkUrls.every(toNative) && needIds.every((id) => linkIds.has(id)) && linkUrls.some((u) => u.includes(`store.steampowered.com/app/${N}`)),
        linkUrls.map((u, i) => `${links[i].label}=${toNative(u) ? 'native' : u}`).join(' | ') || 'no links',
    );

    // Last: it navigates. Exactly what Steam's news card does on click: Navigator.App(event.appid, { gidPartnerEvent }).
    const click = JSON.parse(
        await shared.ev(`(async () => {
            const e = appActivityStore.m_mapAppActivity.get(${N});
            let news = null;
            for (const day of e?.m_mapActivityByDay?.values() ?? []) for (const ev of day.m_rgEvents ?? []) if (ev.announcementGID && !news) news = ev;
            if (!news) return JSON.stringify({ error: 'no native news event' });
            const model = await news.GetEvent();
            const nav = SteamUIStore.WindowStore.MainWindowInstance?.Navigator;
            if (!model || !nav) return JSON.stringify({ error: 'no event model or navigator' });
            nav.App(model.appid, { gidPartnerEvent: model.GID });
            let loc = null;
            for (let i = 0; i < 20; i++) {
                await new Promise((r) => setTimeout(r, 250));
                loc = MainWindowBrowserManager.m_lastLocation;
                if (loc?.state?.event_to_show?.eventid === model.GID) break;
            }
            const P = ${plugin};
            let redirected = null;
            for (let i = 0; i < 20; i++) {
                redirected = P.nativeSectionsDiagnostics?.()?.lastNative?.event ?? null;
                if (redirected === ${N}) break;
                await new Promise((r) => setTimeout(r, 250));
            }
            const out = { path: loc?.pathname ?? null, eventid: loc?.state?.event_to_show?.eventid ?? null, gid: model.GID, redirected };
            if (out.eventid) MainWindowBrowserManager.m_history.replace(loc.pathname, {}); // close the overlay
            return JSON.stringify(out);
        })()`),
    );
    check(
        '16. Native news click opens the event on the shortcut page',
        !click.error && click.path === `/library/app/${S}` && click.eventid === click.gid && click.redirected === N,
        click.error ?? `path ${click.path}, event ${click.eventid ? 'shown' : 'not shown'}, overlay appid ${click.redirected}`,
    );
    check('17. Community Content loads the native app (Steam loader m_unAppID)', communityAppid === N, `loader ${communityAppid}`);
} finally {
    const p = JSON.parse(prev ?? 'null');
    if (p) await shared.ev(`(MILLENNIUM_API.Navigation.Navigate(${JSON.stringify(p)}), true)`).catch(() => {});
    shared.close();
    desk.close();
}
const pass = results.filter(Boolean).length;
console.log(`\n${pass} PASS / ${results.length - pass} FAIL`);
process.exit(pass === results.length ? 0 : 1);
