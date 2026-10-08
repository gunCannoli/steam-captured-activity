// Live test: the achievement banner's sound replacement and display time, and settings round-trips through
// Millennium's Configuration API (the same store the settings panel writes). Needs a theme whose `achievements`
// block has tier sounds (SOUND_THEME, default ps5: the user's own ps5 theme, which wins over the bundled one); SKIP
// without one.
// Leaves every setting as it found it: it snapshots the stored settings first and puts them back in `finally`
// (the check near the end resets them to prove defaults, so it would otherwise wipe the user's), EA-K6.
import { connect, resolvePluginName } from './cdp.mjs';
import { bannerTiming } from '../frontend/banner/timing.ts';
import { installFixtureThemes } from './fixture-themes.mjs';

const cdp = await connect();
const PLUGIN = await resolvePluginName(cdp, 'EN_PLUGIN', 'enhanced-notifications');
const SOUND_THEME = process.env.SOUND_THEME ?? 'ps5';
let failed = false;
const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failed = true;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
class Skip extends Error {}
// Drive settings through the plugin's own exports (what the settings panel calls).
const plugin = (expr) => cdp.evaluate(`window.PLUGIN_LIST['${PLUGIN}'].${expr}`);
// steam_midnight / steam_tiers left the bundle (c874c63): installed for this run, removed in `finally`.
const removeFixtures = await installFixtureThemes((e) => cdp.evaluate(e), PLUGIN);
const stored = () => cdp.evaluate(`window.MILLENNIUM_API.ffi('core', 'PluginConfig_GetAll')('${PLUGIN}')`);
const before = (await stored()) ?? {};

// Record sounds: WebAudio buffers started in SharedJSContext (ours), and every
// PlayNavSound request (Steam's own chime; it dispatches to a native player, so
// the request itself is the reliable signal).
const instrumented = await cdp.evaluate(`(() => {
    // Idempotent: always wrap the saved originals, so re-running never stacks wrappers.
    window.__eaSounds = [];
    const proto = AudioBufferSourceNode.prototype;
    window.__eaOrigStart ??= proto.start;
    const start = window.__eaOrigStart;
    proto.start = function (...a) {
        window.__eaSounds.push({ kind: 'webaudio', seconds: +(this.buffer?.duration ?? 0).toFixed(2) });
        return start.apply(this, a);
    };
    let req;
    const key = '__ea_probe_' + Date.now();
    window.webpackChunksteamui.push([[key], { [key]: (m, e, r) => (req = r) }, (r) => r(key)]);
    for (const id of Object.keys(req.m)) {
        if (!req.m[id].toString().includes('m_fnCallbackOnPlaySound')) continue;
        for (const v of Object.values(req(id))) {
            if (v && typeof v.PlayNavSound === 'function' && v.m_fnCallbackOnPlaySound) {
                v.__eaOrigPlayNavSound ??= v.PlayNavSound;
                const orig = v.__eaOrigPlayNavSound;
                v.PlayNavSound = function (...a) { window.__eaSounds.push({ kind: 'steam', id: a[0] }); return orig.apply(this, a); };
                window.__eaRestoreNav = () => { v.PlayNavSound = orig; };
                return 'ok';
            }
        }
    }
    return 'PlayNavSound not found';
})()`);
if (instrumented !== 'ok') throw new Error(`Sound instrumentation failed: ${instrumented}`);

async function fire() {
    await cdp.evaluate(`(async () => { window.__eaSounds.length = 0; await window.NotificationStore.TestAchievement(480); return true; })()`);
    await wait(1500);
    const sounds = JSON.parse(await cdp.evaluate(`JSON.stringify(window.__eaSounds)`));
    const targets = await (await fetch('http://127.0.0.1:8080/json')).json();
    const toast = targets.find((t) => /notificationtoasts/i.test(t.title));
    let banner = null;
    if (toast) {
        const win = await connect(toast.title);
        banner = await win.evaluate(`document.querySelector('.ea-banner')?.className ?? null`);
        win.close();
    }
    await wait(5500);
    return { sounds, banner };
}

try {
    // The bundled themes ship with no sound (no local paths in the bundle). Sound-dependent checks need a theme that
    // has tier sounds: the user's own (SOUND_THEME). Point the plugin at it for the duration of this test.
    await plugin(`setSetting('theme', ${JSON.stringify(SOUND_THEME)})`);
    let soundTheme = false;
    for (let i = 0; i < 10 && !soundTheme; i++) {
        await wait(300);
        soundTheme = await cdp.evaluate(`(() => {
            const t = window.PLUGIN_LIST['${PLUGIN}'].achievementTheme();
            return t?.name === ${JSON.stringify(SOUND_THEME)} && t.sounds.size > 0;
        })()`);
    }
    if (!soundTheme) throw new Skip(`theme '${SOUND_THEME}' with achievement tier sounds is not installed on this machine`);

    const duration = await cdp.evaluate(`(() => {
        const proto = Object.getPrototypeOf(window.NotificationStore);
        let cfg, found;
        for (let t = 0; t < 256 && !found; t++) {
            proto.PlayNotificationSound.call({ ChooseSound(c) { cfg = c; return null; } }, { eType: t });
            try { if (cfg?.proto && new cfg.proto().getClassName() === 'CClientNotificationAchievement') found = cfg; } catch {}
        }
        return found?.toastDurationMS;
    })()`);
    // The plugin writes the banner's whole lifetime (entrance + display + exit + settle,
    // banner/timing.ts), not the bare display time, so Steam keeps the popup open through the fades.
    const themed = JSON.parse(await cdp.evaluate(`JSON.stringify((() => { const t = window.PLUGIN_LIST['${PLUGIN}'].achievementTheme()?.theme; return { animation: t?.animation, displayTimeMs: t?.displayTimeMs }; })())`));
    const expected = bannerTiming(themed.animation, themed.displayTimeMs).totalMs;
    check('display_time_ms applied to Steam achievement toast config', themed.displayTimeMs === 4000 && duration === expected, `toastDurationMS=${duration}, expected ${expected}`);

    // First toast may find the AudioContext suspended (then Steam's chime plays once); warm it up.
    await fire();
    let r = await fire();
    const ours = r.sounds.filter((s) => s.kind === 'webaudio');
    const steam = r.sounds.filter((s) => s.kind === 'steam');
    check('themed sound played', ours.length === 1, JSON.stringify(r.sounds));
    check("Steam's chime suppressed", steam.length === 0);

    // A tier with no sound gets the notification sound; steam_tiers has neither, so Steam's chime,
    // while the banner is themed whenever the theme has an `achievements` block.
    await plugin(`setSetting('theme', 'steam_tiers')`);
    await wait(500);
    r = await fire();
    check('theme with no sound -> Steam chime plays', r.sounds.some((s) => s.kind === 'steam'));
    check('theme with no sound -> no themed sound', !r.sounds.some((s) => s.kind === 'webaudio'), JSON.stringify(r.sounds));
    check('theme with no sound -> banner still themed', !!r.banner);
    await plugin(`setSetting('theme', ${JSON.stringify(SOUND_THEME)})`);
    await wait(500);
    await plugin(`setSetting('theme', 'does_not_exist')`);
    await wait(1000);
    r = await fire();
    check('missing theme -> stock toast', r.banner === null);
    check('missing theme -> Steam chime', r.sounds.some((s) => s.kind === 'steam') && !r.sounds.some((s) => s.kind === 'webaudio'), JSON.stringify(r.sounds));

    // A theme without an `achievements` block: no banner, the notification style and its sound (none: Steam's chime).
    await plugin(`setSetting('theme', 'steam_midnight')`);
    await wait(500);
    r = await fire();
    check('no achievements block -> no banner', r.banner === null);
    check('no achievements block -> Steam chime', r.sounds.some((s) => s.kind === 'steam') && !r.sounds.some((s) => s.kind === 'webaudio'), JSON.stringify(r.sounds));

    await plugin(`resetSettings()`);
    await wait(1500);

    r = await fire();
    // The shipped default is "Steam default" (settings.json theme '<steam>'): no theme, no banner, no themed sound.
    check('defaults restored -> Steam default (no theme, no banner, no themed sound)', (await plugin(`activeTheme()?.name ?? null`)) === null && r.banner === null && !r.sounds.some((s) => s.kind === 'webaudio'));
    const left = await stored();
    check('setting a default / reset leaves nothing stored', left && Object.keys(left).length === 0, JSON.stringify(left));
} catch (e) {
    if (!(e instanceof Skip)) throw e;
    console.log(`SKIP  ${e.message}`);
    await plugin(`resetSettings()`);
} finally {
    removeFixtures();
    await plugin(`resetSettings()`).catch(() => {});
    for (const [key, value] of Object.entries(before)) await plugin(`setSetting(${JSON.stringify(key)}, ${JSON.stringify(value)})`).catch(() => {});
    // Put back what the instrumentation wrapped, so a script run after this one sees the real functions.
    await cdp.evaluate(`(() => {
        if (window.__eaOrigStart) AudioBufferSourceNode.prototype.start = window.__eaOrigStart;
        window.__eaRestoreNav?.();
        return true;
    })()`).catch(() => {});
    cdp.close();
}
process.exitCode = failed ? 1 : 0;
