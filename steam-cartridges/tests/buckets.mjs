// CDP test for the bucket engine, ADR-0036 model (LIVE; writes plugin config, so
// run it only with the user's OK). Needs Steam with DevTools and two fixture
// collections. Usage: node tests/buckets.mjs
// Assumes the plugin's exports are reachable as PLUGIN_LIST[name] (dev copy first).
import { connect } from '../../enhanced-achievements/tests/cdp.mjs';

const cdp = await connect();
const ev = (x) => cdp.evaluate(x);
const api = `(() => { const l = window.PLUGIN_LIST ?? {}; return l['steam-cartridges-dev'] ?? l['steam-cartridges']; })()`;
let failed = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`);
    if (!ok) failed++;
};

const original = await ev(`${api}.bucketReport()`);
const stored = await ev(`MILLENNIUM_API.ffi('core', 'PluginConfig_GetAll')(Object.keys(PLUGIN_LIST).includes('steam-cartridges-dev') ? 'steam-cartridges-dev' : 'steam-cartridges')`);
const collections = original.collections;
const find = (n) => collections.find((c) => c.name === n);
const steam = find(process.env.STEAM_COLL ?? 'SC_STEAM');
const retro = find(process.env.RETRO_COLL ?? 'SC_RETRO');
if (!steam || !retro) throw new Error('fixture collections not found (set STEAM_COLL / RETRO_COLL)');
const rule = (c, bucket, include = [], exclude = []) => ({ id: c.id, name: c.name, bucket, include, exclude });
const set = (rules) => ev(`${api}.setSetting('buckets', ${JSON.stringify({ rules })})`);
const bucketOf = async (name) => {
    const r = await ev(`(${api}.bucketReport())`);
    const app = await ev(`window.appStore.allApps.find(a => a.display_name === ${JSON.stringify(name)})?.appid`);
    return r.games[app]?.bucket;
};

try {
    await set([rule(steam, 'steam-store'), rule(retro, 'web-scraping')]);
    check('SC_RETRO_A web-scraping', (await bucketOf('SC_RETRO_A')) === 'web-scraping');
    check('SC_STEAM_OWNED steam-store', (await bucketOf('SC_STEAM_OWNED')) === 'steam-store');
    check('AM2R default steam-store (ADR-0036)', (await bucketOf('AM2R')) === 'steam-store');
    const rep = await ev(`${api}.bucketReport()`);
    check('SC_RETRO_BOTH conflict', rep.conflicts.some((c) => c.name === 'SC_RETRO_BOTH'));

    // Without restart: retro -> Neither, then an exclude pattern, then back.
    await set([rule(steam, 'steam-store'), rule(retro, 'none')]);
    check('retro -> Neither reflects live', (await bucketOf('SC_RETRO_A')) === 'none');
    await set([rule(steam, 'steam-store'), rule(retro, 'web-scraping', [], ['SC_RETRO_A'])]);
    check('exclude pattern falls through to the default', (await bucketOf('SC_RETRO_A')) === 'steam-store');
    await set([rule(steam, 'steam-store'), rule(retro, 'web-scraping')]);
    check('retro back to Web Scraping', (await bucketOf('SC_RETRO_A')) === 'web-scraping');
    console.log('Manual: open SC_RETRO_A / AM2R Game Info; AM2R has no Steam match, so the log shows the web fallback.');
} finally {
    const prev = typeof stored?.buckets === 'string' ? JSON.parse(stored.buckets) : stored?.buckets;
    if (prev !== undefined) await ev(`${api}.setSetting('buckets', ${JSON.stringify(prev)})`);
    else await ev(`${api}.resetSettings()`);
    console.log('restored the user\'s buckets setting');
}
process.exit(failed ? 1 : 0);
