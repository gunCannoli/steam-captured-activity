// Live: the Epic Steam Overlay Workaround end to end (ADR-0057). Launch an Epic launcher-link shortcut through
// SteamClient.Apps.RunGame (the path Steam's Play takes; the plugin wraps it), then check: a running Epic launcher was
// closed first, the game starts and Steam shows the shortcut running; after the game is closed, the reaper ends the
// launcher (after Epic's cloud sync) and Steam stops showing it running.
//   node tests/live/probes/epic_hold.mjs [appid=2308047645 (Jotunnslayer)] [exeLike=Jotunnslayer] [playSeconds=60]
// Needs the Steam lock and the setting "Epic Steam Overlay Workaround" on. Launches and closes the game.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const APPID = Number(process.argv[2] ?? 2308047645);
const EXE_LIKE = process.argv[3] ?? 'Jotunnslayer';
const PLAY_S = Number(process.argv[4] ?? 60);
const GID = ((BigInt(APPID) << 32n) | 0x02000000n).toString();
const LOG = 'C:/game/steam/logs/webhelper_js.txt';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failed = true;
};
const ps = (cmd) => {
    try {
        return execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();
    } catch {
        return '';
    }
};
const procs = (like) => ps(`(Get-Process | Where-Object { $_.Path -like '*${like}*' } | Measure-Object).Count`) | 0;
async function shared(expression) {
    const t = (await (await fetch('http://127.0.0.1:8080/json')).json()).find((x) => x.title === 'SharedJSContext');
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    const res = await new Promise((resolve) => {
        ws.onmessage = (e) => resolve(JSON.parse(e.data));
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true } }));
    });
    ws.close();
    return res.result?.result?.value;
}
const running = async () => JSON.parse((await shared(`JSON.stringify(SteamUIStore.RunningApps?.map?.((a) => a.appid) ?? [])`)) || '[]').includes(APPID);
// Lines from this run, by their timestamp (local time): Steam flushes its log late, so a line offset taken at the start
// missed the hold's line in three runs where it was logged (2026-10-15).
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const since = stamp(new Date(Date.now() - 2000));
const newLog = () => readFileSync(LOG, 'utf8').split('\n').filter((l) => /Epic overlay workaround/.test(l) && (l.match(/^\[([^\]]+)\]/)?.[1] ?? '') >= since);

const launcherBefore = procs('EpicGamesLauncher.exe');
console.log(`INFO  Epic launcher processes before: ${launcherBefore}`);
await shared(`(SteamClient.Apps.RunGame('${GID}', '', -1, 100), 1)`);
let game = 0;
for (let i = 0; i < 120 && !game; i++) {
    await wait(1000);
    game = procs(`Epic Games*${EXE_LIKE}`) || procs(`${EXE_LIKE}*.exe`);
}
check('the game started', game > 0, `${game} process(es)`);
check('Steam shows the shortcut running', await running());
await wait(PLAY_S * 1000);
check('still running after the play time', await running());

ps(`Get-Process | Where-Object { $_.Path -like '*Epic Games*${EXE_LIKE}*' } | Stop-Process -Force`);
let done = false;
for (let i = 0; i < 180 && !done; i++) {
    await wait(1000);
    done = !(await running()) && procs('EpicGamesLauncher.exe') === 0;
}
check('after the game, the launcher was ended and Steam stopped showing it running', done, `launcher ${procs('EpicGamesLauncher.exe')}, running ${await running()}`);
// Read last: Steam writes its log file with a delay, so the hold's line may not be there when the game starts.
if (launcherBefore > 0) check('the running launcher was closed before the game (the hold)', newLog().some((l) => /launcher closed before/.test(l)), newLog().join(' | ').slice(0, 300));
console.log(`INFO  ${newLog().map((l) => l.replace(/^.*Epic overlay workaround: /, '')).join(' | ').slice(0, 600)}`);
console.log(failed ? 'FAIL  epic hold' : 'PASS  epic hold');
process.exit(failed ? 1 : 0);
