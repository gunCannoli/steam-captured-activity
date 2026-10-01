// npm run test:live: every live check against the running Steam client
// (127.0.0.1:8080, enhanced-achievements or -dev deployed). Migration plan § E0b.
//
// Snapshots the plugin's stored settings first and restores exactly those at the
// end, whatever the checks did. Checks marked `theme` start with THEME (default
// ps5) selected, because they assert a themed banner. A check PASSes when it
// exits 0, prints no FAIL line and prints its `must` line; it SKIPs when its
// output matches `skipWhen` (e.g. Big Picture is not open).
//
// Desktop checks run first; bigpicture.mjs last (open Big Picture before running
// it, or it SKIPs). tests/architecture.test.ts fails if a live script is not listed.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, resolvePluginName } from './cdp.mjs';

const THEME = process.env.THEME ?? 'ps5';
const here = dirname(fileURLToPath(import.meta.url));
const checks = [
    { file: 'smoke.mjs', theme: true, must: /^PASS {2}themed banner rendered/m },
    { file: 'tiers.mjs', theme: true, must: /^PASS {2}completes game \(50%\): then a exceptional toast/m },
    { file: 'safety.mjs', must: /^PASS {2}settings restored/m },
    { file: 'queue-stress.mjs', must: /^PASS {2}queue off: never Steam fallback toast/m },
    { file: 'captures.mjs', must: /^PASS {2}settings restored/m },
    { file: 'settings-sound.mjs', must: /^(PASS|SKIP) /m },
    { file: 'reset.mjs', must: /^PASS {2}switched off: unavailable/m },
    { file: 'bigpicture.mjs', theme: true, must: /^PASS {2}themed banner in Big Picture/m, skipWhen: /is Big Picture open\?/ },
];

// Boot health first (workspace-only script, absent in a public repo): no point running checks on a broken client.
const health = join(here, '..', '..', 'steam-health.mjs');
if (existsSync(health)) {
    const r = spawnSync(process.execPath, [health], { encoding: 'utf8', timeout: 60_000 });
    if (r.status !== 0) {
        console.log(`FAIL  boot health
${r.stdout}${r.stderr}`);
        process.exit(1);
    }
    console.log('PASS  boot health');
}

const cdp = await connect();
const name = await resolvePluginName(cdp, 'EA_PLUGIN', 'enhanced-achievements');
const plugin = (expr) => cdp.evaluate(`window.PLUGIN_LIST[${JSON.stringify(name)}].${expr}`);
const stored = () => cdp.evaluate(`window.MILLENNIUM_API.ffi('core', 'PluginConfig_GetAll')(${JSON.stringify(name)})`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function restore(snapshot) {
    await plugin('resetSettings()');
    for (const [key, value] of Object.entries(snapshot)) await plugin(`setSetting(${JSON.stringify(key)}, ${JSON.stringify(value)})`);
}

async function selectTheme() {
    await plugin(`setSetting('theme', ${JSON.stringify(THEME)})`);
    for (let i = 0; i < 40 && (await plugin('activeTheme()?.name')) !== THEME; i++) await wait(250);
}

/** A check must not start while the previous one's toast windows are still up (they flake smoke and queue-stress). */
async function waitForNoToasts(maxMs = 60_000) {
    for (let t = 0; t < maxMs; t += 500) {
        const targets = await (await fetch('http://127.0.0.1:8080/json')).json();
        if (!targets.some((x) => /notificationtoasts/i.test(x.title))) return;
        await wait(500);
    }
}

function run(c) {
    const r = spawnSync(process.execPath, [join(here, c.file)], { encoding: 'utf8', timeout: 300_000, env: { ...process.env, EA_PLUGIN: name, THEME } });
    const out = (r.stdout ?? '') + (r.stderr ?? '');
    const skipped = c.skipWhen?.test(out) === true;
    return { ok: skipped || (r.status === 0 && c.must.test(out) && !/^FAIL/m.test(out)), skipped, out };
}

const snapshot = (await stored()) ?? {};
let bad = 0;
try {
    for (const c of checks) {
        await waitForNoToasts();
        if (c.theme) await selectTheme();
        const r = run(c);
        console.log(`${r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'}  ${c.file}`);
        if (!r.ok) {
            bad++;
            console.log(r.out.split('\n').slice(-15).join('\n'));
        }
        await restore(snapshot);
    }
} finally {
    await restore(snapshot);
    const left = (await stored()) ?? {};
    const sorted = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
    const same = sorted(left) === sorted(snapshot);
    console.log(`${same ? 'PASS' : 'FAIL'}  settings restored  (${JSON.stringify(left)})`);
    if (!same) bad++;
    cdp.close();
}
process.exit(bad ? 1 : 0);
