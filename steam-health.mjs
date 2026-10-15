// Boot health check: is Steam's UI up, and did every enabled plugin load?
//
//   node steam-health.mjs [--wait <seconds>] [--steam <dir>]
//
// Answers "did our deploy break Steam, or is it Steam?" in one command. It works
// without the DevTools port too: the log checks run first, so a Steam started
// without -cef-enable-debugging still gets a diagnosis.
//
// FAIL (exit 1): Steam not running, running without CDP, SharedJSContext hung,
// an enabled plugin not loaded, the main window empty or visible but not
// painting, a surface that exceeded its error budget since this boot.
// WARN / INFO: context that explains a broken window without being ours
// (resume from sleep, GPU fallback, Millennium error-boundary catches).
//
// --wait polls the live checks until they pass or the time runs out (use it
// right after a restart). Steam's path: --steam, then $STEAM_PATH, then the
// registry; never a hardcoded default (ADR-0011).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PORT = process.env.CDP_PORT ?? "8080";
const argv = process.argv.slice(2);
const opt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
};
const waitSeconds = Number(opt("--wait") ?? 0);

let failed = 0;
const say = (level, msg) => {
    if (level === "FAIL") failed++;
    console.log(`${level.padEnd(4)}  ${msg}`);
};

function steamDir() {
    const candidates = [opt("--steam"), process.env.STEAM_PATH];
    try {
        const out = execFileSync("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"], { encoding: "utf8" });
        candidates.push(out.match(/SteamPath\s+REG_SZ\s+(.+)/)?.[1]?.trim());
    } catch {}
    return candidates.find((c) => c && existsSync(join(c, "steam.exe")));
}

function running() {
    try {
        const out = execFileSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8" }).toLowerCase();
        return { steam: out.includes('"steam.exe"'), helpers: (out.match(/"steamwebhelper\.exe"/g) ?? []).length };
    } catch {
        return { steam: false, helpers: 0 };
    }
}

// Lines of a Steam log written since the current Steam start ("Client version:" opens each start).
function sinceBoot(file) {
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, "latin1").split(/\r?\n/);
    let start = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (/^\[[^\]]+\] Client version:/.test(lines[i])) {
            start = i;
            break;
        }
    }
    return lines.slice(start);
}

const stamp = (line) => line.slice(1, 20);
const short = (line) => line.replace(/%c|background:[^;]*;|color:[^;]*;|padding:[^;]*;|font-weight:[^;]*;/g, "").replace(/\s+/g, " ").slice(0, 200);

function checkLogs(dir) {
    const js = sinceBoot(join(dir, "logs", "webhelper_js.txt"));
    if (!js.length) return say("WARN", "webhelper_js.txt not found; log checks skipped");
    say("INFO", `this Steam start: ${stamp(js[0])}; last JS log line: ${stamp(js.findLast((l) => l.startsWith("[")) ?? js[0])}`);

    for (const l of js.filter((l) => l.includes("exceeded its error budget"))) say("FAIL", `error budget: ${short(l)}`);

    // The frontend loaded but its backend is not reachable under that name: every RPC fails
    // (a bundle built for another name, e.g. "<name>-dev-dev" after an interrupted dev.ps1, 2026-10-01).
    const notRunning = [...new Set(js.map((l) => l.match(/plugin not running: ([\w-]+)/)?.[1]).filter(Boolean))];
    for (const p of notRunning) say("FAIL", `a frontend calls backend "${p}", which is not running (bundle and plugin.json name disagree, or the backend crashed)`);

    const pluginErrors = js.filter((l) => /SteamUI: ERROR: %c [A-Z][\w -]+ %c/.test(l));
    for (const l of pluginErrors.slice(0, 5)) say("WARN", `plugin error: ${short(l)}`);
    if (pluginErrors.length > 5) say("WARN", `... and ${pluginErrors.length - 5} more plugin errors`);

    // Millennium's ErrorBoundaryHook also logs every error Steam itself reports (ReportError), not only render failures.
    // A catch right after a known Steam-side error is Steam's own noise, said as INFO; the rest stay WARN, with the error
    // line before each so the owner shows.
    const STEAM_NOISE = [
        // The in-game overlay's Game Overview news asks for a running shortcut's partner events; a shortcut has no
        // official game group (verified 2026-10-15, module 74388).
        [/LoadAdjacentPartnerEvents hit error/, "the in-game overlay asked for a shortcut's news (a shortcut has no game group)"],
    ];
    const noise = new Map();
    const real = [];
    js.forEach((l, i) => {
        if (!(l.includes("ErrorBoundaryHook") && l.includes("Caught an error"))) return;
        const before = js.slice(Math.max(0, i - 3), i);
        const known = STEAM_NOISE.find(([re]) => before.some((b) => re.test(b)));
        if (known) noise.set(known[1], (noise.get(known[1]) ?? 0) + 1);
        else real.push({ at: l, cause: [...before].reverse().find((b) => /ERROR:/.test(b)) });
    });
    for (const [why, n] of noise) say("INFO", `Steam reported ${n} error(s) of its own: ${why}; not a plugin`);
    if (real.length) {
        say("WARN", `Millennium's error boundary caught ${real.length} error(s) since start (first ${stamp(real[0].at)}); open the failing page with DevTools to see whose`);
        for (const r of real.slice(0, 3)) if (r.cause) say("WARN", `  after: ${short(r.cause)}`);
    }

    const resumes = js.filter((l) => l.includes("SuspendResume: Received resume request"));
    if (resumes.length) say("INFO", `the PC resumed from sleep at ${resumes.map(stamp).join(", ")}: a window that stops painting after a resume is Steam/CEF, not a plugin (steam-debug.md Trap 12)`);

    const gpu = sinceBoot(join(dir, "logs", "webhelper.txt")).filter((l) => l.includes("--type=gpu-process") && l.includes("--use-gl=disabled"));
    if (gpu.length) say("INFO", `CEF's GPU process fell back to software rendering at ${gpu.map(stamp).join(", ")} (normal on this machine over RDP)`);
}

async function targets() {
    try {
        return await (await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(2000) })).json();
    } catch {
        return null;
    }
}

async function evaluate(target, expression, ms = 5000) {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    try {
        await new Promise((ok, ko) => ((ws.onopen = ok), (ws.onerror = ko)));
        const reply = new Promise((ok) => (ws.onmessage = (e) => ok(JSON.parse(e.data))));
        ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true } }));
        const msg = await Promise.race([reply, new Promise((ok) => setTimeout(() => ok("timeout"), ms))]);
        if (msg === "timeout") return { hung: true };
        if (msg.result?.exceptionDetails) return { error: msg.result.exceptionDetails.exception?.description ?? "exception" };
        return { value: msg.result?.result?.value };
    } finally {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            await new Promise((resolve) => {
                const timer = setTimeout(resolve, 500);
                ws.onclose = () => {
                    clearTimeout(timer);
                    resolve();
                };
                try {
                    ws.close();
                } catch {
                    clearTimeout(timer);
                    resolve();
                }
            });
        }
    }
}

// One pass over the live checks. Returns the problems found (empty = healthy) and INFO lines.
async function live(enabled) {
    const problems = [];
    const info = [];
    const list = await targets();
    if (!list) return { problems: ["no CDP at 127.0.0.1:" + PORT + " (Steam started without -cef-enable-debugging, or still starting): restart with start-steam-dev.ps1 -Restart"], info };

    const shared = list.find((t) => t.title === "SharedJSContext");
    if (!shared) return { problems: ["no SharedJSContext target yet"], info };
    const ping = await evaluate(shared, "JSON.stringify({ plugins: Object.keys(window.PLUGIN_LIST ?? {}), mode: await SteamClient.UI.GetUIMode() })");
    if (ping.hung) return { problems: ["SharedJSContext does not answer in 5 s: the UI thread is hung (steam-debug.md Trap 10)"], info };
    if (ping.error) return { problems: [`SharedJSContext: ${ping.error.slice(0, 200)}`], info };
    if (!ping.value) return { problems: ["SharedJSContext returned empty response (still initializing)"], info };
    let pingData;
    try {
        pingData = JSON.parse(ping.value);
    } catch (e) {
        return { problems: [`SharedJSContext returned invalid JSON: ${e.message}`], info };
    }
    const { plugins, mode } = pingData;

    const missing = enabled.filter((p) => !plugins.includes(p));
    if (missing.length) problems.push(`enabled but not loaded: ${missing.join(", ")} (loaded: ${plugins.join(", ") || "none"})`);
    else info.push(`plugins loaded: ${enabled.join(", ")}`);

    const bigPicture = mode === 4;
    const win = bigPicture ? list.find((t) => t.title === "Steam Big Picture Mode") : list.find((t) => t.url.includes("minwidth=1010"));
    const label = bigPicture ? "Big Picture window" : "desktop window";
    if (!win) {
        problems.push(`no ${label} target (UI mode ${mode})`);
        return { problems, info };
    }
    const dom = await evaluate(
        win,
        `JSON.stringify({ nodes: document.querySelectorAll('*').length, text: (document.body?.innerText ?? '').length, visible: document.visibilityState,
          painted: await new Promise((r) => { const t = setTimeout(() => r(false), 1500); requestAnimationFrame(() => { clearTimeout(t); r(true); }); }) })`,
    );
    if (dom.hung) problems.push(`${label} does not answer in 5 s`);
    else if (dom.error) problems.push(`${label}: ${dom.error.slice(0, 200)}`);
    else if (!dom.value) problems.push(`${label} returned empty DOM response`);
    else {
        let d;
        try {
            d = JSON.parse(dom.value);
        } catch (e) {
            problems.push(`${label} returned invalid JSON: ${e.message}`);
        }
        if (d) {
            if (d.nodes < 300 || d.text < 50) problems.push(`${label} is empty (${d.nodes} elements, ${d.text} chars of text)`);
            else info.push(`${label} rendered (${d.nodes} elements)`);
            if (d.visible !== "visible") info.push(`${label} is hidden (tray or minimized): painting not checked`);
            else if (!d.painted) problems.push(`${label} is visible but not painting (no animation frame in 1.5 s): a CEF/GPU state, restart Steam (steam-debug.md Trap 12)`);
            else info.push(`${label} is painting`);
        }
    }
    return { problems, info };
}

const dir = steamDir();
if (!dir) {
    say("FAIL", "Steam not found: pass --steam <dir> or set STEAM_PATH");
    process.exit(1);
}

const deadline = Date.now() + waitSeconds * 1000;
let proc = running();
while (!proc.steam && Date.now() < deadline) {
    await new Promise((ok) => setTimeout(ok, 1000));
    proc = running();
}
if (!proc.steam) say("FAIL", "steam.exe is not running");
else say("INFO", `steam.exe running with ${proc.helpers} steamwebhelper processes`);

let enabled = [];
try {
    enabled = JSON.parse(readFileSync(join(dir, "millennium", "config", "config.json"), "utf8")).plugins?.enabledPlugins ?? [];
} catch (e) {
    say("WARN", `Millennium config.json unreadable (${e.message}); plugin check skipped`);
}

if (proc.steam) {
    let r = await live(enabled);
    while (r.problems.length && Date.now() < deadline) {
        await new Promise((ok) => setTimeout(ok, 3000));
        r = await live(enabled);
    }
    for (const l of r.info) say("INFO", l);
    for (const p of r.problems) say("FAIL", p);
    if (!r.problems.length) say("PASS", "Steam UI is up and every enabled plugin loaded");
}

// After the live wait, so a fresh start has had time to log its plugin start-up
// (start-up RPCs fail a few seconds after the window renders).
if (waitSeconds > 0) await new Promise((ok) => setTimeout(ok, 8000));
checkLogs(dir);

// exitCode, not exit(): exiting while a WebSocket is closing trips a libuv assert on Windows.
process.exitCode = failed ? 1 : 0;
