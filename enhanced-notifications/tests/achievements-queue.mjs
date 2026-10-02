// Live stress test for the achievement queue, against a running Steam (-dev) with
// enhanced-notifications deployed.
//
//   node tests/achievements-queue.mjs            (THEME=<name> to pick the theme; default ps5)
//
// 1. A theme without an `achievements` block (steam_midnight): a preview achievement is no
//    banner, and gets the notification style like every toast (data-en-type on its window).
// 2. Queue on + a burst of previews clicked faster than a human can: every
//    sample must show at most one visible banner, every visible banner pinned
//    at the same spot and size, in the order fired, with the tier it was fired
//    for, never Steam's fallback toast; all of them must eventually show; and
//    their sounds (theme clip or Steam chime) spaced out with the banners,
//    never stacked on arrival.
// 3. Queue off: the same burst may overlap, but every banner still shows with
//    its own tier (no tier swapped between rapid previews).
//
// Restores exactly the settings stored before it ran (it used to reset theme and
// queue to their defaults, wiping the user's theme choice). Previews never capture.
import { connect, resolvePluginName } from './cdp.mjs';

const THEME = process.env.THEME ?? 'ps5';
const BURST = ['magic', 'rare', 'normal', 'exceptional', 'magic'];

const cdp = await connect();
const name = await resolvePluginName(cdp, 'EN_PLUGIN', 'enhanced-notifications');
const plugin = (expr) => cdp.evaluate(`window.PLUGIN_LIST[${JSON.stringify(name)}].${expr}`);
const stored = () => cdp.evaluate(`window.MILLENNIUM_API.ffi('core', 'PluginConfig_GetAll')(${JSON.stringify(name)})`);
const before_ = (await stored()) ?? {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failed = true;
};

/** One sample of every achievement toast popup, read from SharedJSContext. */
const sample = () =>
    cdp.evaluate(`JSON.stringify([...g_PopupManager.GetPopups()]
        .filter((p) => /^notificationtoasts_/.test(p.m_strName) && (p.window ?? p.m_popup) && !(p.window ?? p.m_popup).closed)
        .map((p) => {
            const w = p.window ?? p.m_popup, doc = w.document, b = doc.querySelector('.ea-banner');
            const cls = b?.className ?? '';
            return {
                name: p.m_strName,
                banner: !!b,
                waiting: cls.includes('ea-waiting'),
                done: cls.includes('ea-done'),
                tier: cls.match(/ea-tier-(\\w+)/)?.[1] ?? null,
                title: doc.querySelector('.ea-title')?.textContent ?? null,
                opacity: b ? Number(w.getComputedStyle(b).opacity) : null,
                enType: doc.body?.getAttribute('data-en-type') ?? null,
                steamText: b ? '' : (doc.body?.innerText ?? '').trim().slice(0, 60),
                x: w.screenX, y: w.screenY, w: w.outerWidth, h: w.outerHeight,
            };
        }))`).then(JSON.parse);

async function waitForNoToasts(maxMs = 60_000) {
    for (let t = 0; t < maxMs; t += 500) {
        if ((await sample()).length === 0) return true;
        await wait(500);
    }
    return false;
}

/** Fire the burst as fast as possible, then sample until every popup is gone. */
async function burst() {
    await Promise.all(BURST.map((tier) => plugin(`previewTier(${JSON.stringify(tier)})`)));
    const samples = [];
    for (let t = 0; t < 90_000; t += 150) {
        const s = await sample();
        samples.push(s);
        // Done when no toast is on screen and none is left waiting: with the notifications queue, Steam shows one at a
        // time and there is a moment with no window between two banners.
        if (t > 3000 && s.length === 0 && (await cdp.evaluate('window.NotificationStore.m_rgNotificationToasts.length')) === 0) break;
        await wait(150);
    }
    return samples;
}

try {
    check('no toast on screen before starting', await waitForNoToasts());

    // --- 1. no achievements block -----------------------------------------------
    await plugin(`setSetting('theme', 'steam_midnight')`);
    for (let i = 0; i < 20 && (await plugin(`activeTheme()?.name`)) !== 'steam_midnight'; i++) await wait(250);
    check('no achievements block: no banner theme', (await plugin(`achievementTheme()`)) === null);
    await plugin(`previewTier('normal')`);
    let stock = null;
    for (let i = 0; i < 20 && !stock?.steamText; i++) {
        await wait(250);
        stock = (await sample())[0] ?? null;
    }
    check('no achievements block: toast shown', !!stock);
    check('no achievements block: our banner not drawn', stock && !stock.banner);
    check('no achievements block: the notification style', stock && stock.enType === 'Achievement', `data-en-type=${stock?.enType}`);
    check('no achievements block: toast cleared', await waitForNoToasts());

    // --- 2. queue on -------------------------------------------------------------
    await plugin(`setSetting('theme', ${JSON.stringify(THEME)})`);
    await plugin(`setSetting('queue.enabled', true)`);
    for (let i = 0; i < 20 && (await plugin(`activeTheme()?.name`)) !== THEME; i++) await wait(250);
    check(`theme "${THEME}" loaded`, (await plugin(`activeTheme()?.name`)) === THEME);

    // Log every achievement sound: WebAudio clip starts and Steam chime decisions.
    await cdp.evaluate(`(() => {
        const log = (window.__eaQueueSounds = []);
        const src = AudioBufferSourceNode.prototype;
        window.__eaQueueStart ??= src.start;
        src.start = function (...a) { log.push(Date.now()); return window.__eaQueueStart.apply(this, a); };
        const proto = Object.getPrototypeOf(window.NotificationStore);
        window.__eaQueueChoose ??= proto.ChooseSound;
        // Steam's ProcessNotification also asks ChooseSound once on arrival without
        // playing anything; only the PlayNotificationSound path is a real play.
        proto.ChooseSound = function (cfg, n) {
            const playing = (new Error().stack ?? '').includes('PlayNotificationSound');
            if (playing && n?.data?.getClassName?.() === 'CClientNotificationAchievement') log.push(Date.now());
            return window.__eaQueueChoose.call(this, cfg, n);
        };
        return true;
    })()`);
    const samples = await burst();
    const sounds = JSON.parse(
        await cdp.evaluate(`(() => {
            AudioBufferSourceNode.prototype.start = window.__eaQueueStart;
            Object.getPrototypeOf(window.NotificationStore).ChooseSound = window.__eaQueueChoose;
            return JSON.stringify(window.__eaQueueSounds);
        })()`),
    );
    const gaps = sounds.slice(1).map((t, i) => t - sounds[i]);
    const visible = (s) => s.filter((p) => p.banner && !p.waiting && !p.done && p.opacity > 0.01);
    const maxVisible = Math.max(...samples.map((s) => visible(s).length));
    // A real fallback is Steam's own toast (it has text); an empty popup is one sampled
    // before React rendered into it or after it unmounted, while Steam closes it.
    const isFallback = (p) => !p.banner && p.steamText !== '';
    const fallbacks = samples.flat().filter(isFallback);
    const fallback = fallbacks.length;
    const spots = new Set(samples.flatMap((s) => visible(s).map((p) => `${p.x},${p.y},${p.w}x${p.h}`)));
    const shown = [];
    for (const s of samples) for (const p of visible(s)) if (shown.at(-1)?.name !== p.name) shown.push(p);
    check('queue on: never more than one banner visible', maxVisible <= 1, `max ${maxVisible}`);
    check('queue on: never Steam fallback toast', fallback === 0, fallbacks.map((p) => p.steamText).join(' | '));
    check('queue on: every visible banner at one spot/size', spots.size === 1, [...spots].join(' | '));
    check('queue on: all burst toasts shown', shown.length === BURST.length, `${shown.length}/${BURST.length}`);
    check('queue on: one sound per toast', sounds.length === BURST.length, `${sounds.length} sounds`);
    check('queue on: sounds follow the banners, not stacked on arrival', gaps.every((g) => g > 1000), `gaps ${gaps.join(', ')} ms`);
    check('queue on: tiers in firing order', JSON.stringify(shown.map((p) => p.tier)) === JSON.stringify(BURST), shown.map((p) => p.tier).join(','));

    // --- 3. queue off ------------------------------------------------------------
    await plugin(`setSetting('queue.enabled', false)`);
    const offSamples = await burst();
    const tiersSeen = new Map();
    for (const p of offSamples.flat()) if (p.banner && p.tier) tiersSeen.set(p.name, p.tier);
    const counts = (arr) => JSON.stringify([...arr].sort());
    check('queue off: every toast themed with its own tier', counts(tiersSeen.values()) === counts(BURST), [...tiersSeen.values()].join(','));
    check('queue off: never Steam fallback toast', !offSamples.flat().some(isFallback), offSamples.flat().filter(isFallback).map((p) => p.steamText).join(' | '));
} finally {
    await plugin('resetSettings()').catch(() => {});
    for (const [key, value] of Object.entries(before_)) await plugin(`setSetting(${JSON.stringify(key)}, ${JSON.stringify(value)})`).catch(() => {});
    cdp.close();
}
process.exit(failed ? 1 : 0);
