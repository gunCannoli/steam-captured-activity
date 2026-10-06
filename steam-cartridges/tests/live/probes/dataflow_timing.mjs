// Data flow timing (ADR-0060, dataflow plan Phase 0): open a shortcut, go to the library home, open it again
// (AGENTS.md Routine 2), and report every backend call each view made: its lane, how long it waited in the queue
// and how long the host held it. Needs the Steam lock (it navigates). Read-only otherwise.
//   node tests/live/probes/dataflow_timing.mjs [appid] [settleMs=8000]
// Without an appid it picks a shortcut that has stored achievements.
// PASS lines: paint (Game Info and achievements from disk soon after the view), lanes (no view call waited long).
import { pick, session } from "../cdp.mjs";

const settle = Number(process.argv[3] ?? 8000);
const s = session((await pick("SharedJSContext")).webSocketDebuggerUrl);
await s.ready;
const run = async (expression) => {
    const r = await s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "evaluate failed");
    return r.result?.result?.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const P = `(PLUGIN_LIST['steam-cartridges-dev'] ?? PLUGIN_LIST['steam-cartridges'])`;

if (!(await run(`typeof ${P}?.rpcDiagnostics === 'function'`))) {
    console.log("FAIL probe: the plugin does not export rpcDiagnostics (not deployed?)");
    process.exit(1);
}

let appid = Number(process.argv[2] ?? 0);
if (!appid) {
    appid = await run(`(() => {
      const apps = (appStore.allApps || []).filter((a) => a.app_type === 1073741824);
      for (const a of apps) { const l = ${P}.getLocalAchievements?.(a.appid); if (l && (l.nTotal ?? l.achievements?.length ?? 0) > 0) return a.appid; }
      return apps[0]?.appid ?? 0;
    })()`);
}
if (!appid) {
    console.log("FAIL probe: no shortcut found");
    process.exit(1);
}
const title = await run(`appStore.GetAppOverviewByAppID(${appid})?.display_name ?? ''`);
console.log(`INFO shortcut ${appid} "${title}"`);

if ((await run(`SteamClient.UI.GetUIMode()`)) !== 7) {
    await run(`SteamClient.UI.SetUIMode(7), 1`);
    await wait(8000);
}
const nav = (to) => run(`SteamUIStore.WindowStore.SteamUIWindows.find(w=>w.Navigator?.AppProperties)?.Navigator.${to},1`);

async function view(label) {
    const t0 = await run(`Date.now()`);
    await nav(`App(${appid})`);
    await wait(settle);
    const d = await run(`${P}.rpcDiagnostics()`);
    const calls = d.recent.filter((c) => c.queuedAt >= t0);
    console.log(`\n== ${label}: ${calls.length} call(s) in ${settle} ms`);
    for (const c of calls) {
        console.log(
            `  +${String(c.queuedAt - t0).padStart(5)} ms  ${c.lane.padEnd(10)} ${(c.name + (c.detail ? ` [${c.detail}]` : "")).padEnd(44)} wait ${String(c.startedAt - c.queuedAt).padStart(5)} ms  run ${String(c.endedAt - c.startedAt).padStart(5)} ms${c.ok ? "" : "  FAILED"}`,
        );
    }
    if (d.running) console.log(`  still running: ${d.running.name} (${d.running.lane}) for ${d.running.forMs} ms`);
    // The view sensor can report the same page more than once (Steam's route history); each report paints again.
    // The first paint is the one the user waits for.
    const paint = calls.filter((c) => c.detail?.endsWith("(disk)"));
    const firstPaint = paint.slice(0, 2);
    const paintDone = firstPaint.length === 2 ? Math.max(...firstPaint.map((c) => c.endedAt - t0)) : undefined;
    if (paint.length > 2) console.log(`  INFO the view was reported ${paint.length / 2} times; each painted from disk again`);
    const viewWaits = calls.filter((c) => c.lane === "view").map((c) => c.startedAt - c.queuedAt);
    return { paint: firstPaint.length, paintDone, maxViewWait: viewWaits.length ? Math.max(...viewWaits) : 0 };
}

const first = await view(`A: open "${title}"`);
await nav(`Home()`);
await wait(3000);
const again = await view(`A again (after the library home)`);

const lines = [];
for (const [label, r] of [["first view", first], ["second view", again]]) {
    lines.push([r.paint === 2 && r.paintDone !== undefined && r.paintDone < 3000, `paint (${label}): Game Info and achievements from disk, done ${r.paintDone ?? "-"} ms after the view`]);
    lines.push([r.maxViewWait < 3000, `lanes (${label}): the longest wait of a view call was ${r.maxViewWait} ms`]);
}
for (const [ok, text] of lines) console.log(`${ok ? "PASS" : "FAIL"} ${text}`);
s.close();
process.exit(lines.every(([ok]) => ok) ? 0 : 1);
