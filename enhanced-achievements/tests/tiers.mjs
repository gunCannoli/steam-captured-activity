// Live tier test: dispatches real achievement notifications through Steam's
// NotificationStore.OnNotification with chosen rarity, and checks which tier
// the themed banner used. Screenshots go to $SHOTS_DIR when set.
//
// The protobuf class and eType are found the same way the plugin finds them
// (stand-in call to PlayNotificationSound), not hardcoded.
import { connect } from './cdp.mjs';

const cases = [
    { label: 'normal (50%)', pct: 50, expect: 'normal' },
    { label: 'magic (20%)', pct: 20, expect: 'magic' },
    { label: 'rare (5%)', pct: 5, expect: 'rare' },
    { label: 'no rarity data (0%)', pct: 0, expect: 'normal' },
    { label: 'exceptional (completes game)', pct: 50, expect: 'exceptional', completes: true },
];

const cdp = await connect();
let failed = false;

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

try {
    for (const [i, c] of cases.entries()) {
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
                description: 'enhanced-achievements live tier test', image_url: '',
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
        if (c.completes) await cdp.evaluate(`(window.appAchievementProgressCache.m_achievementProgress.mapCache.delete(${appid}), true)`);
        // Let the toast expire before the next one (display_time_ms + fade).
        await new Promise((r) => setTimeout(r, 6000));
    }
} finally {
    cdp.close();
}
process.exitCode = failed ? 1 : 0;
