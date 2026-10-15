// Live, with a real game: a screenshot taken in game becomes a "captured" card in the game's Activity feed, and leaves
// it again when the screenshot is deleted (steam-captured-activity, ADR-0062).
//   node tests/live/probes/real_capture.mjs [appid=332200 (Axiom Verge)] [processName=AxiomVerge]
// Needs the Steam lock (launches the game, presses Steam's screenshot key F12 in its window, navigates). Deletes the
// screenshot it took.
import { execFileSync } from 'node:child_process';

const APPID = Number(process.argv[2] ?? 332200);
const PROC = process.argv[3] ?? 'AxiomVerge';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failed = true;
};
async function evalIn(title, expression) {
    const t = (await (await fetch('http://127.0.0.1:8080/json')).json()).find((x) => x.title === title);
    if (!t) throw new Error(`no target ${title}`);
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    const res = await new Promise((resolve) => {
        ws.onmessage = (e) => resolve(JSON.parse(e.data));
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true } }));
    });
    ws.close();
    return res.result?.result?.value;
}
const shared = (e) => evalIn('SharedJSContext', e);
const openPage = () => shared(`(SteamUIStore.WindowStore.SteamUIWindows.find((w) => w.Navigator?.AppProperties)?.Navigator.App(${APPID}), 1)`);
/** Media items in our "captured" events of the game's Activity entry (Steam's store, as check_feed.mjs reads it). */
async function capturedCards() {
    await openPage();
    await wait(7000);
    return shared(`(() => {
        const e = window.appActivityStore?.m_mapAppActivity?.get(${APPID});
        let items = 0;
        for (const d of e?.m_mapActivityByDay?.values() ?? []) for (const ev of d.m_rgEvents ?? []) if (ev?.__capturedActivity) items += ev.m_mediaItems.length;
        return items;
    })()`);
}
const last = () => shared(`SteamClient.Screenshots.GetLastScreenshotTaken().then((s) => JSON.stringify(s))`).then((s) => JSON.parse(s || 'null'));

const before = await capturedCards();
const lastBefore = await last();
console.log(`INFO  captured media items before: ${before}`);
await shared(`(SteamClient.Apps.RunGame('${APPID}', '', -1, 100), 1)`);
await wait(25000);
execFileSync('powershell', ['-NoProfile', '-Command', `$p = Get-Process -Name '${PROC}' -ErrorAction SilentlyContinue | Select-Object -First 1; if ($p) { $w = New-Object -ComObject WScript.Shell; [void]$w.AppActivate($p.Id); Start-Sleep -Milliseconds 800; $w.SendKeys('{F12}') }`]);
let shot = null;
for (let i = 0; i < 20 && !shot; i++) {
    await wait(500);
    const s = await last();
    if (s && s.nAppID === APPID && (!lastBefore || s.hHandle !== lastBefore.hHandle || s.nAppID !== lastBefore.nAppID)) shot = s;
}
check('F12 in game took a Steam screenshot', !!shot, shot ? shot.strUrl : 'none');
await shared(`(SteamClient.Apps.TerminateApp('${APPID}', false), 1)`);
await wait(6000);
if (shot) {
    const after = await capturedCards();
    check('the screenshot shows in the "captured" cards of the Activity feed', after === before + 1, `media items before ${before}, after ${after}`);
    const del = await shared(`SteamClient.Screenshots.DeleteLocalScreenshots([{ gameID: '${shot.strGameID}', rgHandles: [${shot.hHandle}] }]).then((r) => JSON.stringify(r))`);
    check('the test screenshot was deleted', JSON.parse(del || '{}').bSuccess === true, del);
    await shared(`(SteamUIStore.WindowStore.SteamUIWindows.find((w) => w.Navigator?.AppProperties)?.Navigator.App(435150), 1)`);
    await wait(3000);
    const cleaned = await capturedCards();
    check('after deleting it, the card leaves the feed', cleaned === before, `before ${before}, now ${cleaned}`);
}
console.log(failed ? 'FAIL  real capture' : 'PASS  real capture');
process.exit(failed ? 1 : 0);
