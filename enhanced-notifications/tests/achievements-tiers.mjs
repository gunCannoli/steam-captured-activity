// Live tier test: dispatches real achievement notifications through Steam's
// NotificationStore.OnNotification with chosen rarity, and checks which tier
// the themed banner used (a theme with an `achievements` block must be selected;
// tests/run-live.mjs selects ps5). Screenshots go to $SHOTS_DIR when set.
//
// The protobuf class and eType are found the same way the plugin finds them
// (stand-in call to PlayNotificationSound), not hardcoded.
//
// A game-completing unlock keeps its own rarity tier; the plugin then posts a
// separate synthetic 100% toast (tier exceptional) ~1.5 s later (the design
// since fe25714), so that case checks both toasts.
import { connect } from './cdp.mjs';

const cases = [
    { label: 'normal (50%)', pct: 50, expect: 'normal' },
    { label: 'magic (20%)', pct: 20, expect: 'magic' },
    { label: 'rare (5%)', pct: 5, expect: 'rare' },
    { label: 'no rarity data (0%)', pct: 0, expect: 'normal' },
    { label: 'completes game (50%)', pct: 50, expect: 'normal', completes: true, then: 'exceptional' },
];

const cdp = await connect();
let failed = false;

/** Tiers of every themed banner currently in a toast window. */
async function allBannerTiers() {
    const targets = (await (await fetch('http://127.0.0.1:8080/json')).json()).filter((t) => /notificationtoasts/i.test(t.title));
    const tiers = [];
    for (const t of targets) {
        const win = await connect(t.title);
        try {
            const cls = await win.evaluate(`document.querySelector('.ea-banner')?.className ?? null`);
            const tier = cls?.match(/ea-tier-(\w+)/)?.[1];
            if (tier) tiers.push(tier);
        } finally {
            win.close();
        }
    }
    return tiers;
}

async function bannerTier() {
    const targets = await (await fetch('http://127.0.0.1:8080/json')).json();
    const toast = targets.find((t) => /notificationtoasts/i.test(t.title));
    if (!toast) return { tier: null };
    const win = await connect(toast.title);
    try {
        const cls = await win.evaluate(`document.querySelector('.ea-banner')?.className ?? null`);
        return { tier: cls?.match(/ea-tier-(\w+)/)?.[1] ?? null, win };
    } catch (error) {
        win.close();
        throw error;
    }
}

/** Each case must start on a clean screen, or bannerTier() could read a toast still closing. */
async function waitForNoToasts(maxMs = 30_000) {
    for (let t = 0; t < maxMs; t += 500) {
        const targets = await (await fetch('http://127.0.0.1:8080/json')).json();
        if (!targets.some((x) => /notificationtoasts/i.test(x.title))) return true;
        await new Promise((r) => setTimeout(r, 500));
    }
    return false;
}

try {
    for (const [i, c] of cases.entries()) {
        if (!(await waitForNoToasts())) {
            failed = true;
            console.log(`FAIL  ${c.label}: a previous toast never cleared`);
            continue;
        }
        // A fresh, never-seen appid so tier memos and caches cannot leak between cases.
        const appid = 900000 + i;
        await cdp.evaluate(`(() => {
            const ns = window.NotificationStore, proto = Object.getPrototypeOf(ns);
            let cfg, type;
            for (let t = 0; t < 256 && type === undefined; t++) {
                proto.PlayNotificationSound.call({ ChooseSound(c) { cfg = c; return null; } }, { eType: t });
                try { if (cfg?.proto && new cfg.proto().getClassName() === 'CClientNotificationAchievement') type = t; } catch {}
                cfg = type === undefined ? undefined : cfg;
            }
            const cache = window.appAchievementProgressCache.m_achievementProgress.mapCache;
            ${c.completes ? `cache.set(${appid}, { appid: ${appid}, unlocked: 9, total: 10, percentage: 90, all_unlocked: false });` : ''}
            const msg = cfg.proto.fromObject({
                achievement_id: 'EA_TEST', appid: ${appid}, name: ${JSON.stringify(c.label)},
                description: 'enhanced-notifications live tier test', image_url: '',
                achieved: true, rtime_unlocked: Math.floor(Date.now() / 1000),
                current_progress: 0, max_progress: 0, min_progress: 0, global_achieved_pct: ${c.pct},
            });
            ns.OnNotification(ns.m_nNextTestNotificationID++, type, msg.serializeBinary());
            return true;
        })()`);
        await new Promise((r) => setTimeout(r, 1500));
        const { tier, win } = await bannerTier();
        const ok = tier === c.expect;
        if (!ok) failed = true;
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.label}: banner tier = ${tier}, expected ${c.expect}`);
        if (win && process.env.SHOTS_DIR) await win.screenshot(`${process.env.SHOTS_DIR}/tier-${c.expect}-${c.pct}.png`);
        win?.close();
        if (c.then) {
            let seen = [];
            for (let t = 0; t < 12 && !seen.includes(c.then); t++) {
                await new Promise((r) => setTimeout(r, 500));
                seen = await allBannerTiers();
            }
            const okThen = seen.includes(c.then);
            if (!okThen) failed = true;
            console.log(`${okThen ? 'PASS' : 'FAIL'}  ${c.label}: then a ${c.then} toast (seen: ${seen.join(',') || 'none'})`);
        }
        if (c.completes) await cdp.evaluate(`(window.appAchievementProgressCache.m_achievementProgress.mapCache.delete(${appid}), true)`);
        // Let the toast expire before the next one (display_time_ms + fade).
        await new Promise((r) => setTimeout(r, 6000));
    }
} finally {
    cdp.close();
}
process.exitCode = failed ? 1 : 0;
