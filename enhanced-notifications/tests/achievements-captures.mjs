// Live test: Phase 7 auto-captures, dry-run only. Creates nothing (no real
// screenshot, clip or marker) — it only exercises the planning/scheduling path
// with setCaptureDryRun(true), which logs the RPC it would have sent instead
// of sending it. Restores every setting it touches.
import { connect, resolvePluginName } from './cdp.mjs';

const cdp = await connect();
const PLUGIN = await resolvePluginName(cdp, 'EN_PLUGIN', 'enhanced-notifications');
let failed = false;
const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failed = true;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const plugin = (expr) => cdp.evaluate(`window.PLUGIN_LIST['${PLUGIN}'].${expr}`);
const stored = () => cdp.evaluate(`window.MILLENNIUM_API.ffi('core', 'PluginConfig_GetAll')('${PLUGIN}')`);

// The user's own stored settings, restored exactly at the end (never wiped).
const before_ = (await stored()) ?? {};
try {
    // 1. recordingDiagnostics() resolves the service and the live store.
    const diag = JSON.parse(await plugin('recordingDiagnostics()').then((r) => JSON.stringify(r)));
    check('recordingDiagnostics(): service resolved', diag.service === true, JSON.stringify(diag));
    check('recordingDiagnostics(): g_GRS resolved', diag.grs === true, JSON.stringify(diag));

    // 2. Enable every capture and turn on dry-run.
    await plugin(`setSetting('screenshot.enabled', true)`);
    await plugin(`setSetting('recording.enabled', true)`);
    await plugin(`setSetting('recording.add_timeline_marker', true)`);
    await wait(300);
    await plugin('setCaptureDryRun(true)');

    // 3. Fire Steam's own test achievement (no game running: appid 480, Spacewar).
    const before = JSON.parse(await plugin('captureLog()').then((r) => JSON.stringify(r)));
    await cdp.evaluate(`window.NotificationStore.TestAchievement(480).then(() => true)`);
    await wait(1500);

    // 4. Assert the newest log entry: no running timeline, no RPC (eresult) sent.
    const after = JSON.parse(await plugin('captureLog()').then((r) => JSON.stringify(r)));
    const entry = after[after.length - 1];
    // The log is a ring buffer (20 entries): once full its length no longer grows, so a newer timestamp also counts.
    const isNew = after.length > before.length || (entry?.at ?? 0) > (before[before.length - 1]?.at ?? 0);
    check('captureLog(): new entry recorded', isNew, JSON.stringify(entry));
    if (isNew) {
        check('captureLog(): appid 480', entry.appid === 480, JSON.stringify(entry));
        check("captureLog(): skipped no-running-timeline", entry.skipped?.[0]?.reason === 'no-running-timeline', JSON.stringify(entry.skipped));
        check('captureLog(): no eresult on any action (nothing sent)', !entry.actions?.some((a) => 'eresult' in a), JSON.stringify(entry.actions));
    }

    // 5. previewTier() must never schedule a capture (suppressed).
    const beforePreview = JSON.parse(await plugin('captureLog()').then((r) => JSON.stringify(r)));
    await plugin(`previewTier('normal')`);
    await wait(1500);
    const afterPreview = JSON.parse(await plugin('captureLog()').then((r) => JSON.stringify(r)));
    check('previewTier(): no new capture log entry (suppressed)', afterPreview.length === beforePreview.length, `${beforePreview.length} -> ${afterPreview.length}`);

    // 6. Optional: with a real recorded game running, assert a real plan (still dry-run, no RPC).
    if (process.env.RUNNING) {
        const appid = await plugin('runningGameAppid()');
        check('RUNNING: a game with a running timeline was found', typeof appid === 'number', String(appid));
        if (typeof appid === 'number') {
            const beforeRun = JSON.parse(await plugin('captureLog()').then((r) => JSON.stringify(r)));
            await plugin(`fireTestUnlock(${appid}, 'Phase 7 dry-run test')`);
            await wait(2500);
            const afterRun = JSON.parse(await plugin('captureLog()').then((r) => JSON.stringify(r)));
            const runEntry = afterRun[afterRun.length - 1];
            const gotNew = afterRun.length > beforeRun.length;
            check('RUNNING: new log entry for the real game', gotNew, JSON.stringify(runEntry));
            if (gotNew) {
                const kinds = (runEntry.actions ?? []).map((a) => a.kind);
                check('RUNNING: planned screenshot and/or clip with a timeline_id', kinds.some((k) => k === 'screenshot' || k === 'clip') && runEntry.actions.every((a) => a.request?.timeline_id || a.request?.start?.timeline_id), JSON.stringify(runEntry.actions));
                check('RUNNING: no RPC actually sent (dry-run)', !runEntry.actions.some((a) => 'eresult' in a), JSON.stringify(runEntry.actions));
            }
        }
    } else {
        console.log('SKIP  RUNNING=1 scenario (no game/recording set up for this run)');
    }
} finally {
    // 7. Restore dry-run mode and exactly the settings stored before the test.
    await plugin('setCaptureDryRun(false)');
    await plugin('resetSettings()');
    for (const [key, value] of Object.entries(before_)) await plugin(`setSetting(${JSON.stringify(key)}, ${JSON.stringify(value)})`);
    const left = (await stored()) ?? {};
    const sorted = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
    check('settings restored to what was stored before the test', sorted(left) === sorted(before_), `${JSON.stringify(before_)} -> ${JSON.stringify(left)}`);
    cdp.close();
}
process.exitCode = failed ? 1 : 0;
