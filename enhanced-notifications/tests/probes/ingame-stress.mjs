// Stress, desktop with a game running (pre-release, 2026-10-15): launch a game, let it run, fire a burst of previews
// (notifications and every achievement tier) while it is in front, and check every toast window got the theme's style
// or the banner, nothing tripped an error budget, and no plugin error was logged. Closes the game at the end.
//   node tests/probes/ingame-stress.mjs [gameId=332200] [settleMs=30000]
// Needs the Steam lock (it launches a game and shows toasts) and a theme with an `achievements` block (ps5 here).
import { readFileSync } from 'node:fs';
import { connect, resolvePluginName } from '../cdp.mjs';

const GAME = process.argv[2] ?? '332200';
const SETTLE = Number(process.argv[3] ?? 30000);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failed = true;
};
const cdp = await connect();
const P = await resolvePluginName(cdp, 'EN_PLUGIN', 'enhanced-notifications');
const plugin = (e) => cdp.evaluate(`window.PLUGIN_LIST['${P}'].${e}`);
const logLines = () => readFileSync('C:/game/steam/logs/webhelper_js.txt', 'utf8').split('\n').length;
const startLine = logLines();

await cdp.evaluate(`(SteamClient.Apps.RunGame(${JSON.stringify(GAME)}, '', -1, 100), 1)`);
await wait(SETTLE);
const running = await cdp.evaluate(`JSON.stringify(SteamUIStore.RunningApps?.map?.((a) => a.appid) ?? [])`);
check('the game is running', JSON.parse(running).length > 0, running);

const seen = [];
/** Distinct toast states seen (Big Picture reuses one or two toast views for every toast, so windows undercount). */
const states = new Set();
const watch = async (ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        const targets = await (await fetch('http://127.0.0.1:8080/json')).json();
        for (const t of targets.filter((x) => /^notificationtoasts_/.test(x.title))) {
            if (seen.some((s) => s.title === t.title && s.done)) continue;
            try {
                const w = await connect(t.title);
                const state = JSON.parse(await w.evaluate(`JSON.stringify({ type: document.body?.getAttribute('data-en-type') ?? null, banner: !!document.querySelector('.ea-banner:not(.ea-waiting)'), tier: document.querySelector('.ea-banner:not(.ea-waiting)')?.className.match(/ea-tier-([a-z]+)/)?.[1] ?? null, style: !!document.getElementById('enhanced-notifications-theme') })`));
                if (state.type) states.add(`type:${state.type}`);
                if (state.tier) states.add(`tier:${state.tier}`);
                w.close();
                const prev = seen.find((s) => s.title === t.title);
                if (prev) Object.assign(prev, { type: prev.type ?? state.type, banner: prev.banner || state.banner, style: prev.style || state.style });
                else seen.push({ title: t.title, ...state });
            } catch {
                /* a toast window closing mid-read */
            }
        }
        await wait(400);
    }
};
await plugin(`preview('DownloadComplete')`);
await plugin(`preview('CloudSyncFailure')`);
for (const tier of ['normal', 'magic', 'rare', 'exceptional']) await plugin(`previewTier('${tier}')`);
await watch(45000);

const styled = seen.filter((s) => s.type || s.banner);
check('every preview was seen styled (2 notification types, 4 banner tiers)', states.size >= 6, [...states].sort().join(', '));
check('toast windows appeared while the game ran', seen.length >= 1, `${seen.length} windows`);
check('every toast window got the theme (style or banner)', styled.length === seen.length, JSON.stringify(seen.map((s) => [s.title.replace('notificationtoasts_', ''), s.type, s.banner])));
check('achievement banners rendered', seen.filter((s) => s.banner).length >= 1);
const safety = JSON.parse((await cdp.evaluate(`JSON.stringify(window.PLUGIN_LIST['${P}'].safetyDiagnostics?.() ?? {})`).catch(() => '{}')) || '{}');
check('no error budget tripped or error counted', !(safety.tripped ?? []).length && !Object.keys(safety.errors ?? {}).length, JSON.stringify(safety));
const newLines = readFileSync('C:/game/steam/logs/webhelper_js.txt', 'utf8').split('\n').slice(startLine);
const pluginErrors = newLines.filter((l) => /SteamUI: ERROR: %c (Enhanced Notifications|Steam Cartridges|Steam Captured Activity)/.test(l) || /Uncaught/.test(l));
check('no plugin error or uncaught exception logged', pluginErrors.length === 0, pluginErrors.slice(0, 2).join(' | ').slice(0, 300));

await cdp.evaluate(`(SteamClient.Apps.TerminateApp(${JSON.stringify(GAME)}, false), 1)`);
console.log(failed ? 'FAIL  in-game stress' : 'PASS  in-game stress');
process.exit(failed ? 1 : 0);
