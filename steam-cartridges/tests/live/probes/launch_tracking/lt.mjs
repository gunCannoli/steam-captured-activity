// Test-shortcut driver for the launch-tracking experiments (only shortcuts named "LT-..." it made itself).
//   node lt.mjs add <name> <exe> <startDir> <launchOptions>   -> appid
//   node lt.mjs run <appid> | stop <appid> | remove <appid> | state <appid> | watch <appid> <seconds> | rec <appid> start|stop
import { pick, session } from "../../cdp.mjs";
const [cmd, ...rest] = process.argv.slice(2);
const s = session((await pick("SharedJSContext")).webSocketDebuggerUrl); await s.ready;
const ev = async (expression) => {
    const r = await s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.slice(0, 400));
    return r.result?.result?.value;
};
const gid = (appid) => ((BigInt(appid >>> 0) << 32n) | 0x02000000n).toString();
const stateExpr = (appid) => `(() => {
  const g = '${gid(Number(appid))}';
  const running = (window.SteamUIStore?.RunningApps || []).some(a => (a.appid >>> 0) === ${Number(appid) >>> 0});
  let tl = null;
  for (const [tid, e] of window.g_GRS.m_mapActiveTimelines) {
    const l = e?.loader; if (!l) continue; let id; try { id = l.GetGameID(); } catch { continue; }
    if (id !== g || !l.BIsTimelineRunning(tid)) continue;
    tl = { tid, ms: Math.round(l.GetRunningTimelineDurationMS(tid)), rec: !!l.m_mapRunningTimelines?.get(tid)?.m_runningRecording };
  }
  return JSON.stringify({ t: new Date().toTimeString().slice(0, 8), running, tl });
})()`;
const ts = () => new Date().toTimeString().slice(0, 8);
try {
    if (cmd === "add") {
        const [name, exe, dir, opts] = rest;
        if (!name.startsWith("LT-")) throw new Error("test shortcuts must be named LT-...");
        const appid = await ev(`(async () => { const id = await SteamClient.Apps.AddShortcut(${JSON.stringify(name)}, ${JSON.stringify(exe)}, ${JSON.stringify(dir)}, ${JSON.stringify(opts)});
          await new Promise(r => setTimeout(r, 1500)); SteamClient.Apps.SetShortcutName(id, ${JSON.stringify(name)}); SteamClient.Apps.SetShortcutLaunchOptions(id, ${JSON.stringify(opts)}); return id; })()`);
        console.log(appid >>> 0, gid(appid));
    } else if (cmd === "run") {
        console.log(ts(), "run", await ev(`(() => { SteamClient.Apps.RunGame('${gid(Number(rest[0]))}', '', -1, 100); return 'asked'; })()`));
    } else if (cmd === "stop") {
        console.log(ts(), "stop", await ev(`(() => { SteamClient.Apps.TerminateApp('${gid(Number(rest[0]))}', false); return 'asked'; })()`));
    } else if (cmd === "remove") {
        const appid = Number(rest[0]) >>> 0;
        const name = await ev(`(() => appStore.GetAppOverviewByAppID(${appid})?.display_name || '')()`);
        if (!String(name).startsWith("LT-")) throw new Error("refusing to remove a shortcut not named LT-: " + name);
        console.log("remove", name, await ev(`(() => { SteamClient.Apps.RemoveShortcut(${appid}); return 'ok'; })()`));
    } else if (cmd === "opts") {
        const appid = Number(rest[0]) >>> 0;
        const name = await ev(`(() => appStore.GetAppOverviewByAppID(${appid})?.display_name || '')()`);
        if (!String(name).startsWith("LT-")) throw new Error("refusing to edit a shortcut not named LT-: " + name);
        console.log("opts", name, await ev(`(() => { SteamClient.Apps.SetShortcutLaunchOptions(${appid}, ${JSON.stringify(rest[1])}); return 'ok'; })()`));
    } else if (cmd === "state") {
        console.log(await ev(stateExpr(rest[0])));
    } else if (cmd === "watch") {
        const end = Date.now() + Number(rest[1]) * 1000; let last = "";
        while (Date.now() < end) {
            const v = await ev(stateExpr(rest[0])); const k = v.replace(/"t":"[^"]*",/, "").replace(/"ms":\d+,/, "");
            if (k !== last) { console.log(v); last = k; }
            await new Promise((r) => setTimeout(r, 1000));
        }
    } else if (cmd === "rec") {
        console.log(ts(), "rec", rest[1], await ev(`(async () => { const r = await window.g_GRS.${rest[1] === "start" ? "StartRecording" : "StopRecording"}('${gid(Number(rest[0]))}'); return JSON.stringify(r ?? null); })()`));
    } else if (cmd === "eval") {
        console.log(await ev(rest[0]));
    } else console.log("unknown command");
} catch (e) { console.log("ERROR", e.message); }
s.close(); process.exit(0);
