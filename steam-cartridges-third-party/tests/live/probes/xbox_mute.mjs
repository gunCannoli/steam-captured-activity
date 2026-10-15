// Live: the Xbox notification mute (ADR-0065, release plan H15). With "Mute Steam notifications while playing" on,
// launching an Xbox shortcut mutes Steam's toasts (a test toast opens no toast window), and quitting it unmutes them.
//   node tests/live/probes/xbox_mute.mjs [appid=3436498948 (Pool Blitz)]
// Needs the Steam lock and the setting on (read at start-up). Launches and closes the game.
const APPID = Number(process.argv[2] ?? 3436498948);
const GID = ((BigInt(APPID) << 32n) | 0x02000000n).toString();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
import { execFileSync } from 'node:child_process';
/** Close the game this test started: Steam's TerminateApp does not reach a GDK game, which leaves Steam's tree. */
function closeGameProcesses(pfnLike = 'BattlePool') {
    try {
        execFileSync('powershell', ['-NoProfile', '-Command', `Get-Process | Where-Object { $_.Path -like '*WindowsApps*${pfnLike}*' } | Stop-Process -Force`], { stdio: 'ignore' });
    } catch {
        /* nothing to close */
    }
}
let failed = false;
const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failed = true;
};

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
const toastWindows = async () => (await (await fetch('http://127.0.0.1:8080/json')).json()).filter((t) => /^notificationtoasts_/.test(t.title)).length;
const muted = () => shared(`typeof Object.getOwnPropertyDescriptor(window.NotificationStore, 'BShouldSupressToasts')?.value === 'function' && window.NotificationStore.BShouldSupressToasts()`);

/** A test toast; returns how many toast windows were seen within 6 s. */
async function testToast() {
    await shared(`(window.NotificationStore.TestDownloadComplete?.(435150), 1)`);
    let most = 0;
    for (let i = 0; i < 15; i++) {
        most = Math.max(most, await toastWindows());
        await wait(400);
    }
    return most;
}

check('no toast window before the test', (await toastWindows()) === 0);
await shared(`(SteamClient.Apps.RunGame('${GID}', '', -1, 100), 1)`);
let on = false;
for (let i = 0; i < 40 && !on; i++) {
    await wait(1000);
    on = await muted();
}
check('launching the Xbox game mutes Steam\'s toasts', on);
check('a test toast opens no toast window while it runs', (await testToast()) === 0);

await shared(`(SteamClient.Apps.TerminateApp('${GID}', false), 1)`);
await wait(5000);
check("after Steam no longer lists it, the mute holds while the game's process still runs (GDK)", await muted());
closeGameProcesses(process.argv[3] ?? 'BattlePool');
// The backend checks the package folder every 15 s (a GDK game leaves Steam's tree).
let off = true;
for (let i = 0; i < 60 && off; i++) {
    await wait(1000);
    off = await muted();
}
check('quitting it unmutes them', !off);
check('a test toast shows again', (await testToast()) > 0);
console.log(failed ? 'FAIL  xbox mute' : 'PASS  xbox mute');
process.exit(failed ? 1 : 0);
