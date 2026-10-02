// npm run test:live: every live check against the running Steam client
// (127.0.0.1:8080, enhanced-notifications or -dev deployed).
//
// Snapshots the plugin's stored settings first and restores exactly those at the
// end, whatever the checks did. A check with a `theme` starts with that theme
// selected (steam_midnight: the notification style only; ps5: with an
// `achievements` block, for the banner checks). A check PASSes when it exits 0,
// prints no FAIL line and prints its `must` line; it SKIPs when its output
// matches `skipWhen` (e.g. Big Picture is not open).
//
// Desktop checks run first; the Big Picture ones last (open Big Picture before
// running them, or they SKIP). tests/architecture.test.ts fails if a live script
// is not listed.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect, resolvePluginName } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const checks = [
    { file: 'safety.mjs', must: /^PASS {2}style on again: the preview is restyled/m },
    { file: 'previews.mjs', theme: 'steam_midnight', must: /^PASS {2}DownloadComplete: restyled in place/m },
    { file: 'sound-duration.mjs', must: /^PASS {2}settings reset, temp theme removed/m },
    { file: 'notifications-queue.mjs', must: /^(PASS {2}queue on: one toast at a time|SKIP {2}desktop only)/m },
    { file: 'placement.mjs', must: /^(PASS {2}placement off: Steam places the toast|SKIP {2}desktop only)/m },
    { file: 'achievements-smoke.mjs', theme: 'ps5', must: /^PASS {2}themed banner rendered/m },
    { file: 'achievements-tiers.mjs', theme: 'ps5', must: /^PASS {2}completes game \(50%\): then a exceptional toast/m },
    { file: 'achievements-safety.mjs', must: /^PASS {2}settings restored/m },
    { file: 'achievements-queue.mjs', must: /^PASS {2}queue off: never Steam fallback toast/m },
    { file: 'achievements-captures.mjs', must: /^PASS {2}settings restored/m },
    { file: 'achievements-settings.mjs', must: /^(PASS|SKIP) /m },
    { file: 'achievements-reset.mjs', must: /^PASS {2}switched off: unavailable/m },
    { file: 'bigpicture.mjs', must: /^(PASS {2}Big Picture: settings reset|SKIP {2}Big Picture is not open)/m },
    { file: 'achievements-bigpicture.mjs', theme: 'ps5', must: /^PASS {2}themed banner in Big Picture/m, skipWhen: /is Big Picture open\?/ },
];

// Hold the Steam lock for the whole run, so no other agent restarts or drives Steam
// meanwhile (AGENTS.md, "Sharing the live Steam client"). Re-entrant through
// STEAM_LOCK_OWNER; released on exit only if taken here. Absent in a public repo.
const lockLib = join(here, '..', '..', 'steam-lock.mjs');
const steamLock = existsSync(lockLib) ? await import(pathToFileURL(lockLib).href) : null;
const lockOwner = process.env.STEAM_LOCK_OWNER ?? 'test-live-enhanced-notifications-' + process.pid;
const lockState = steamLock ? await steamLock.acquire({ owner: lockOwner, purpose: 'enhanced-notifications npm run test:live', wait: 900, ttl: 3600 }) : 'none';
if (lockState === 'timeout') {
    console.log('FAIL  steam-lock: Steam is still in use by another agent after 15 min (node steam-lock.mjs status)');
    process.exit(1);
}
process.on('exit', () => lockState === 'acquired' && steamLock.release({ owner: lockOwner }));
process.on('SIGINT', () => process.exit(130));

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
// enhanced-achievements was merged into this plugin (ADR-0050): loaded too, it would draw a second banner.
const merged = JSON.parse(await cdp.evaluate(`JSON.stringify(Object.keys(window.PLUGIN_LIST || {}).filter((n) => n.startsWith('enhanced-achievements')))`));
if (merged.length) {
    console.log(`FAIL  enhanced-achievements is still loaded (${merged.join(', ')}): disable it in Millennium and restart Steam`);
    cdp.close();
    process.exit(1);
}
const name = await resolvePluginName(cdp, 'EN_PLUGIN', 'enhanced-notifications');
const plugin = (expr) => cdp.evaluate(`window.PLUGIN_LIST[${JSON.stringify(name)}].${expr}`);
const stored = () => cdp.evaluate(`window.MILLENNIUM_API.ffi('core', 'PluginConfig_GetAll')(${JSON.stringify(name)})`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function restore(snapshot) {
    await plugin('resetSettings()');
    for (const [key, value] of Object.entries(snapshot)) await plugin(`setSetting(${JSON.stringify(key)}, ${JSON.stringify(value)})`);
}

async function selectTheme(theme) {
    await plugin(`setSetting('theme', ${JSON.stringify(theme)})`);
    for (let i = 0; i < 40 && (await plugin('activeTheme()?.name')) !== theme; i++) await wait(250);
}

/**
 * A check must not start while the previous one's toast windows are still up (they flake the banner checks). Desktop
 * only: Big Picture's toast window is persistent, so it never goes away.
 */
async function waitForNoToasts(maxMs = 60_000) {
    if ((await cdp.evaluate(`SteamClient.UI.GetUIMode?.()`)) === 4) return;
    for (let t = 0; t < maxMs; t += 500) {
        const targets = await (await fetch('http://127.0.0.1:8080/json')).json();
        if (!targets.some((x) => /notificationtoasts/i.test(x.title))) return;
        await wait(500);
    }
}

function run(c) {
    const r = spawnSync(process.execPath, [join(here, c.file)], { encoding: 'utf8', timeout: 300_000, env: { ...process.env, EN_PLUGIN: name, THEME: c.theme ?? 'ps5' } });
    const out = (r.stdout ?? '') + (r.stderr ?? '');
    const skipped = c.skipWhen?.test(out) === true;
    return { ok: skipped || (r.status === 0 && c.must.test(out) && !/^FAIL/m.test(out)), skipped, out };
}

const snapshot = (await stored()) ?? {};
let bad = 0;
try {
    for (const c of checks) {
        await waitForNoToasts();
        if (c.theme) await selectTheme(c.theme);
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
