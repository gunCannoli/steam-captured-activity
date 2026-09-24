// CDP test for the P3 Steam Store bucket (LIVE; written, not run offline).
// Needs Steam with DevTools, the P0 T6 fixtures, and the buckets from
// tests/buckets.mjs: `SC Test Steam` -> steam-store, `SC Test Retro` -> web-scraping.
// Usage: node tests/steam-store.mjs
// Env: STEAM_COLL / RETRO_COLL (collection names), SC_STEAM_OWNED_NATIVE (native appid of the
// owned fixture, default 435150), SC_STEAM_UNOWNED_NATIVE (default 2820820).
import { connect } from '../../enhanced-achievements/tests/cdp.mjs';

const cdp = await connect();
const ev = (x) => cdp.evaluate(x);
const api = `(() => { const l = window.PLUGIN_LIST ?? {}; return l['steam-cartridges-dev'] ?? l['steam-cartridges']; })()`;
const OWNED_NATIVE = Number(process.env.SC_STEAM_OWNED_NATIVE ?? 435150);
let failed = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`);
    if (!ok) failed++;
};
const appidOf = (name) => ev(`window.appStore.allApps.find(a => a.display_name === ${JSON.stringify(name)})?.appid`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const navigate = async (appid) => {
    await ev(`SteamUIStore.Navigate?.('/library/app/${appid}') ?? window.location.hash`);
    await sleep(9000); // StoreItemCache + CDN fetches
};
const state = () => ev(`${api}.steamStoreState()`);

const owned = await appidOf('SC_STEAM_OWNED');
const unowned = await appidOf('SC_STEAM_UNOWNED');
const retro = await appidOf('SC_RETRO_A');
if (!owned || !unowned || !retro) throw new Error('fixtures SC_STEAM_OWNED / SC_STEAM_UNOWNED / SC_RETRO_A not found');
const groups = await ev(`${api}.bucketReport().games`);
check('SC_STEAM_OWNED is steam-store', groups[owned]?.bucket === 'steam-store');
check('SC_RETRO_A is web-scraping', groups[retro]?.bucket === 'web-scraping');

try {
    // 1. Owned game: mapped from Steam's own knowledge.
    await navigate(owned);
    let s = await state();
    const m = s.mappings[owned];
    check('owned: mapping source "owned"', m?.source === 'owned', JSON.stringify(m));
    check('owned: maps to the native appid', m?.steam_appid === OWNED_NATIVE);
    check('owned: at least one art slot applied', (s.applied_artwork[owned]?.slots?.length ?? 0) >= 1);
    const dev = await ev(`window.appDetailsStore.GetAppData(${owned})?.associationData?.rgDevelopers?.[0]?.strName`);
    check('owned: Game Info shows the native developer', !!dev, String(dev));

    // 2. Unowned game: a search match or suggestions, never a wrong silent match.
    await navigate(unowned);
    s = await state();
    const um = s.mappings[unowned];
    const sugg = s.suggestions[unowned] ?? [];
    check('unowned: search mapping or suggestions', (um && um.source === 'search') || sugg.length > 0, JSON.stringify({ um, sugg }));
    if (um) check('unowned: matches the expected native app', um.steam_appid === Number(process.env.SC_STEAM_UNOWNED_NATIVE ?? 2820820));

    // 3. Retro game: untouched.
    await navigate(retro);
    s = await state();
    check('retro: no steam-store mapping', !s.mappings[retro]);
    check('retro: no applied artwork', !s.applied_artwork[retro]);

    // 4. Clear with reject: mapping gone, appid rejected, not re-applied on reopen.
    await ev(`${api}.clearSteamStore(${owned}, true)`);
    s = await state();
    check('clear: mapping gone', !s.mappings[owned]);
    check('clear: native appid rejected', (s.rejected[owned] ?? []).includes(OWNED_NATIVE));
    await navigate(owned);
    s = await state();
    check('reopen: not re-applied', !s.mappings[owned]);
} finally {
    // Restore the fixture: manual mapping (also lifts the rejection).
    await ev(`${api}.setSteamStoreMapping(${owned}, ${OWNED_NATIVE})`);
    await sleep(9000);
    const s = await state();
    check('fixture restored (manual mapping)', s.mappings[owned]?.source === 'manual');
}
console.log('Manual: run node scratch/check_all_tabs.js <SC_STEAM_OWNED> and <SC_RETRO_A>; node scratch/test_nav_cycle.js <SC_STEAM_OWNED> 435150; verify AM2R capture views unchanged.');
process.exit(failed ? 1 : 0);
