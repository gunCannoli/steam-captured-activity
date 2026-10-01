// npm run test:live: every live check against the running Steam client
// (127.0.0.1:8080, enhanced-notifications or -dev deployed). Same runner as enhanced-achievements'.
//
// Snapshots the plugin's stored settings first and restores exactly those at the
// end, whatever the checks did. Checks marked `theme` start with THEME (default
// steam_midnight) selected, because they assert a restyled toast. A check PASSes
// when it exits 0, prints no FAIL line and prints its `must` line.
//
// tests/architecture.test.ts fails if a live script is not listed.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, resolvePluginName } from './cdp.mjs';

const THEME = process.env.THEME ?? 'steam_midnight';
const here = dirname(fileURLToPath(import.meta.url));
const checks = [
    { file: 'safety.mjs', must: /^PASS {2}style on again: the preview is restyled/m },
    { file: 'categories.mjs', theme: true, must: /^PASS {2}downloads: restyled in place/m },
    { file: 'sound-duration.mjs', must: /^PASS {2}settings reset, temp theme removed/m },
    { file: 'placement.mjs', must: /^PASS {2}placement off: Steam places the toast/m },
];

const cdp = await connect();
const name = await resolvePluginName(cdp, 'EN_PLUGIN', 'enhanced-notifications');
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

function run(c) {
    const r = spawnSync(process.execPath, [join(here, c.file)], { encoding: 'utf8', timeout: 300_000, env: { ...process.env, EN_PLUGIN: name, THEME } });
    const out = (r.stdout ?? '') + (r.stderr ?? '');
    return { ok: r.status === 0 && c.must.test(out) && !/^FAIL/m.test(out), out };
}

const snapshot = (await stored()) ?? {};
let bad = 0;
try {
    for (const c of checks) {
        if (c.theme) await selectTheme();
        const r = run(c);
        console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${c.file}`);
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
