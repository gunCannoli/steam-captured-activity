// Live check for ADR-0045 (achievements in Steam's stores from start-up). Run it right after a Steam restart,
// BEFORE opening any game page: a page view also fills the cache, which would hide a broken preload.
//   node tests/live/probes/ach_preload.mjs [--wait <seconds, default 120>] [--min <shortcuts, default 100>]
// Waits for SharedJSContext and steam-cartridges, then polls Steam's progress cache (bounded, guardrail 15).
// Read-only, except one GetAchievementProgress call for a shortcut that already has an entry (Steam's own read;
// it queues a server request only when the entry is stale, which is what the check looks for).
// Exit 0 when no line starts with FAIL.
import { pick, session, targets } from "../cdp.mjs";

const arg = (name, dflt) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? Number(process.argv[i + 1]) : dflt;
};
const WAIT_S = arg("--wait", 120);
const MIN = arg("--min", 100);
const deadline = Date.now() + WAIT_S * 1000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const line = (status, label, detail = "") => {
    if (status === "FAIL") failed = true;
    console.log(`${status} ${label}${detail ? `  (${detail})` : ""}`);
};

async function sharedContext() {
    while (Date.now() < deadline) {
        try {
            if ((await targets()).some((t) => t.title === "SharedJSContext")) return await pick("SharedJSContext");
        } catch {
            /* Steam's debugger port is not up yet */
        }
        await wait(1000);
    }
    return null;
}

const t = await sharedContext();
if (!t) {
    line("FAIL", "SharedJSContext target", `none within ${WAIT_S}s`);
    process.exit(1);
}
const s = session(t.webSocketDebuggerUrl);
await s.ready;
const ev = async (expression) => {
    const r = await s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return r.result?.exceptionDetails ? { error: String(r.result.exceptionDetails.exception?.description).slice(0, 300) } : r.result?.result?.value;
};

const STATE = `(async () => {
    const list = window.PLUGIN_LIST || {};
    const name = ["steam-cartridges-dev", "steam-cartridges"].find((n) => list[n]);
    const cache = window.appAchievementProgressCache?.m_achievementProgress?.mapCache;
    const shortcuts = cache ? [...cache.entries()].filter(([k]) => k >= 0x80000000) : [];
    const bad = shortcuts.filter(([k, v]) => !(v && v.appid === k && typeof v.percentage === "number" && v.cache_time > 0 && v.vetted === true));
    return {
        uiMode: await window.SteamClient?.UI?.GetUIMode?.(),
        plugin: name ?? null,
        oldExport: name ? typeof list[name].storedAchievementSummaries === "function" : null,
        cacheReady: !!cache,
        n: shortcuts.length,
        bad: bad.length,
        badSample: bad.slice(0, 2).map(([k, v]) => [k, v]),
        withUnlocks: shortcuts.filter(([, v]) => v.unlocked > 0).map(([k]) => k).slice(0, 10),
        signedAppData: [...(window.appDetailsStore?.m_mapAppData?.keys?.() ?? [])].filter((k) => k < 0).length,
    };
})()`;

let st = await ev(STATE);
while (Date.now() < deadline && !(st && !st.error && st.plugin && st.cacheReady && st.n >= MIN)) {
    await wait(2000);
    st = await ev(STATE);
}
if (!st || st.error) {
    line("FAIL", "read Steam's stores", st?.error ?? "no answer");
    s.close();
    process.exit(1);
}

console.log(`INFO uiMode=${st.uiMode} plugin=${st.plugin} shortcutsWithUnlocks=${JSON.stringify(st.withUnlocks)}`);
line(st.plugin ? "PASS" : "FAIL", "steam-cartridges is loaded", st.plugin ?? "not in PLUGIN_LIST");
line(st.oldExport === false ? "PASS" : "FAIL", "storedAchievementSummaries is gone from the public API");
line(st.n >= MIN ? "PASS" : "FAIL", "progress cache holds shortcuts from start-up", `n=${st.n}, min ${MIN}`);
line(st.bad === 0 ? "PASS" : "FAIL", "every shortcut entry has Steam's shape", `bad=${st.bad}${st.bad ? " " + JSON.stringify(st.badSample).slice(0, 300) : ""}`);
line(st.signedAppData === 0 ? "PASS" : "FAIL", "no signed appid entries in appDetailsStore.m_mapAppData", `${st.signedAppData}`);

const probeId = st.withUnlocks.includes(2315502503) ? 2315502503 : st.withUnlocks[0];
if (probeId === undefined) {
    line("SKIP", "no server request for a shortcut", "no shortcut with unlocks in the cache");
} else {
    const q = await ev(`(() => {
        const c = window.appAchievementProgressCache;
        const before = c.m_mapQueuedCacheMisses.has(${probeId});
        const pct = c.GetAchievementProgress(${probeId});
        return { before, queued: c.m_mapQueuedCacheMisses.has(${probeId}), pct };
    })()`);
    line(q && !q.error && !q.before && q.queued === false && typeof q.pct === "number" ? "PASS" : "FAIL",
        "GetAchievementProgress answers from the cache, no server request", `appid ${probeId}: ${JSON.stringify(q)}`);
}
s.close();
process.exit(failed ? 1 : 0);
