// CDP test for the P2 bucket engine (LIVE; not run offline). Needs Steam with
// DevTools and the fixtures from P0 T6. Usage: node tests/buckets.mjs
// Assumes the plugin's exports are reachable as PLUGIN_LIST[name] (dev copy first);
// adjust `api` below if the build exposes them elsewhere.
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
const collections = original.collections;
const find = (n) => collections.find((c) => c.name === n);
const steam = find(process.env.STEAM_COLL ?? 'SC_STEAM');
const retro = find(process.env.RETRO_COLL ?? 'SC_RETRO');
if (!steam || !retro) throw new Error('fixture collections not found (set STEAM_COLL / RETRO_COLL)');
const asg = (c, bucket) => ({ id: c.id, name: c.name, bucket });
const bucketOf = async (name) => {
    const r = await ev(`(${api}.bucketReport())`);
    const app = (await ev(`window.appStore.allApps.find(a => a.display_name === ${JSON.stringify(name)})?.appid`));
    return r.games[app]?.bucket;
};

try {
    await ev(`${api}.setSetting('buckets', { assignments: [${JSON.stringify(asg(steam, 'steam-store'))}, ${JSON.stringify(asg(retro, 'web-scraping'))}] })`);
    check('SC_RETRO_A web-scraping', (await bucketOf('SC_RETRO_A')) === 'web-scraping');
    check('SC_STEAM_OWNED steam-store', (await bucketOf('SC_STEAM_OWNED')) === 'steam-store');
    check('AM2R none', (await bucketOf('AM2R')) === 'none');
    const rep = await ev(`${api}.bucketReport()`);
    check('SC_RETRO_BOTH conflict', rep.conflicts.some((c) => c.name === 'SC_RETRO_BOTH'));

    // Without restart: move retro to Neither, then back.
    await ev(`${api}.setSetting('buckets', { assignments: [${JSON.stringify(asg(steam, 'steam-store'))}] })`);
    check('retro -> Neither reflects live', (await bucketOf('SC_RETRO_A')) === 'none');
    await ev(`${api}.setSetting('buckets', { assignments: [${JSON.stringify(asg(steam, 'steam-store'))}, ${JSON.stringify(asg(retro, 'web-scraping'))}] })`);
    check('retro back to Web Scraping', (await bucketOf('SC_RETRO_A')) === 'web-scraping');
    console.log('Manual: open SC_RETRO_A / AM2R Game Info; check logs for no "Querying IGDB metadata" for AM2R.');
} finally {
    await ev(`${api}.resetSettings()`); // TODO: restore the user's original value if it was non-default
    console.log('original buckets report collections:', original.collections.length);
}
process.exit(failed ? 1 : 0);
