// Research tool: what does this PC "smell" when an Epic or Xbox game unlocks an achievement? (ADR-0056 follow-up)
//
//   node tests/live/probes/unlock_watcher.mjs [--watch <dir>]... [--poll <seconds>] [--no-api] [--only <sensor,...>]
//
// Start it, play the game, unlock one achievement, then press Enter in this console (a MARK line: "I saw the toast
// now"; type a note first if you like). Ctrl+C stops it. Everything is also written, one JSON object per line, to
// scratch/unlock-watch-<time>.jsonl (the console shows a short form). READ-ONLY: it never writes to Steam, the stores
// or the games, and needs no Steam lock (the API poll only reads, over CDP, through the plugin's own RPC).
//
// Sensors (each one is a different place a toast could leave a trace; the log says which one saw it first):
//   windows   every top-level window that appears, changes or goes away (title, class, process, rect, ex-style) and every
//             process start or exit: an overlay toast is usually a new window of GameBar.exe, an Epic overlay helper, ...
//   toasts    Windows' own toast database (wpndatabase.db): every notification any app posts, with its full XML payload
//   files     appends to log / json / xml files under the Epic launcher, Xbox app, Gaming Services and Game Bar folders
//             (plus every --watch <dir>): the new lines, flagged when they say achievement / unlock / trophy / toast
//   events    Windows event logs (PushNotification platform; Application events of Xbox, Gaming, Epic and EOS providers)
//   api       asks the plugin's backend for the shortcut's achievements every N seconds (default 10) and logs when the
//             store first reports a new unlock: how late the API is, compared with the toast
//   Steam     nothing: Steam is not asked anything else.
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import dns from "node:dns/promises";
import { createInterface } from "node:readline";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readSync, closeSync, statSync, watch, writeFileSync, appendFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pick, session } from "../cdp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const values = (n) => args.flatMap((a, i) => (a === n ? [args[i + 1]] : []));
const POLL_S = Number(values("--poll")[0] ?? 10);
const only = new Set((values("--only")[0] ?? "windows,toasts,files,events,api").split(","));
const LOCAL = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
const PROGRAMDATA = process.env.ProgramData ?? "C:\\ProgramData";

// ---- log ------------------------------------------------------------------------------------------------------------
const outDir = join(here, "..", "..", "..", "..", "scratch");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const logFile = join(outDir, `unlock-watch-${stamp}.jsonl`);
const t0 = Date.now();
const KEYWORDS = /achiev|unlock|trophy|trophies|toast|notif|overlay|gamerscore|earned|reward/i;
const NOISE_PROC = /^(conhost|AudioHelper|dotnet|powershell|pwsh|node|WmiPrvSE|svchost|RuntimeBroker)(\.exe)?$/i;
const NOISE_CLASS = /^(tooltips_class32|Microsoft\.UI\.Content\.PopupWindowSiteBridge|IME|MSCTFIME UI|CicMarshalWnd)/i;
// A "candidate" is a deterministic local trace that may mean an unlock; it starts a fast burst of API checks (set by the api sensor).
let burst = () => {};
const lastCandidate = { at: 0, reason: "" };
function candidate(reason, store, data = {}) {
    lastCandidate.at = Date.now();
    lastCandidate.reason = reason;
    log("candidate", reason, { store, ...data }, true);
    burst(store);
}
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n) + `...(+${String(s).length - n})` : String(s));
function log(sensor, kind, data = {}, hot = false, at) {
    const ts = at ?? new Date().toISOString();
    const line = { ts, t: ((Date.now() - t0) / 1000).toFixed(2), sensor, kind, hot: hot || undefined, ...data };
    appendFileSync(logFile, JSON.stringify(line) + "\n");
    const flat = Object.entries(data).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ");
    console.log(`${hot ? "★" : " "} ${ts.slice(11, 23)} ${sensor.padEnd(7)} ${kind.padEnd(9)} ${clip(flat, 400)}`);
}
console.log(`unlock_watcher: writing ${logFile}\nPress Enter (after typing a note, if you like) the moment you SEE the achievement toast. Ctrl+C stops.\n`);

// Three ways to say "I see the toast now": F8 anywhere (global hotkey, works inside the game and over RDP), Enter in this console,
// or `node tests/live/probes/unlock_mark.mjs "note"` from another terminal. The report also marks every unlock the store's API
// reports, at the store's own unlock time, so a missed mark costs nothing.
const mark = (note, how) => log("user", "MARK", { note, how }, true);
createInterface({ input: process.stdin }).on("line", (note) => mark(note || "(toast seen now)", "enter"));

// ---- windows + processes (PowerShell helper) -----------------------------------------------------------------------------
if (only.has("windows")) {
    const ps = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "unlock_watcher_windows.ps1")], { stdio: ["ignore", "pipe", "pipe"] });
    createInterface({ input: ps.stdout }).on("line", (l) => {
        try {
            const o = JSON.parse(l);
            const { kind, at, ...rest } = o;
            if (kind === "hotkey") return mark("(toast seen now)", "F8");
            if (kind === "dns+") {
                log("dns", "resolved", { address: rest.address, name: rest.name }, /epicgames|epicdata|eos|xboxlive|xbox\.com|microsoft\.com|playfab|gamepass/i.test(rest.name ?? ""), at);
                return;
            }
            if (kind === "conn+" || kind === "conn-") {
                const c = rest.c;
                const hotProc = /epic|eos|xbox|gaming|jotunn|jigsaw|gamebar|msedgewebview|WebHelper/i.test(c.proc ?? "");
                const emit = (host) => {
                    log("net", kind, { proc: c.proc, pid: c.pid, remote: c.remote, host, localPort: c.local }, kind === "conn+" && (hotProc || /epicgames|eos|xboxlive|xbox\.com|playfab/i.test(host ?? "")), at);
                    // The game (not the launcher) talking to Epic's online services, or anything to Xbox Live's achievements host.
                    if (kind === "conn+" && /api\.epicgames\.dev/i.test(host ?? "") && !/launcher|epicwebhelper/i.test(c.proc ?? "")) candidate("game-epic-api", "epic", { proc: c.proc, host });
                    if (kind === "conn+" && /achievements\.xboxlive\.com|xboxlive\.com/i.test(host ?? "") && !/^(steam|node)$/i.test(c.proc ?? "")) candidate("xbox-live-host", "xbox", { proc: c.proc, host });
                };
                if (kind === "conn+") {
                    if (c.host) emit(c.host);
                    else {
                        const ip = c.remote.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
                        Promise.race([dns.reverse(ip).then((h) => h[0]), new Promise((r) => setTimeout(() => r(undefined), 1500))]).catch(() => undefined).then(emit);
                    }
                } else emit(undefined);
                return;
            }
            // Our own helpers, console hosts and audio helpers start and stop all the time: kept in the file, not shown.
            const own = /Get-WinEvent|unlock_watcher/.test(rest.cmd ?? "") || rest.ppid === process.pid || NOISE_PROC.test(rest.name ?? "");
            const quiet = own || NOISE_CLASS.test(rest.w?.cls ?? rest.cls ?? "");
            const text = JSON.stringify(rest);
            const hot = !quiet && kind !== "baseline" && ((kind === "window+" && rest.w?.visible && !/ 0x0$/.test(rest.w?.rect ?? "")) || (kind === "window~" && rest.changes?.visible?.endsWith("True")) || KEYWORDS.test(kind.startsWith("window") ? JSON.stringify(rest.w ?? rest) + JSON.stringify(rest.text ?? "") : text));
            if (quiet && !flag("--verbose")) { appendFileSync(logFile, JSON.stringify({ ts: at ?? new Date().toISOString(), t: ((Date.now() - t0) / 1000).toFixed(2), sensor: "windows", kind, quiet: true, ...rest }) + "\n"); return; }
            log("windows", kind, rest, hot, at);
        } catch {
            log("windows", "raw", { line: clip(l, 300) });
        }
    });
    ps.stderr.on("data", (d) => log("windows", "stderr", { text: clip(d, 300) }));
    process.on("exit", () => ps.kill());
}

// ---- toasts: Windows' notification database -------------------------------------------------------------------------
if (only.has("toasts")) {
    const src = join(LOCAL, "Microsoft", "Windows", "Notifications");
    const tmp = mkdtempSync(join(tmpdir(), "unlock-watch-wpn-"));
    const seen = new Map(); // Id -> true
    let first = true;
    const decode = (blob) => {
        if (!blob) return "";
        const b = Buffer.from(blob);
        return b.length > 1 && b[1] === 0 ? b.toString("utf16le") : b.toString("utf8");
    };
    const poll = () => {
        try {
            for (const f of ["wpndatabase.db", "wpndatabase.db-wal", "wpndatabase.db-shm"]) if (existsSync(join(src, f))) copyFileSync(join(src, f), join(tmp, f));
            const db = new DatabaseSync(join(tmp, "wpndatabase.db"), { readOnly: true });
            const rows = db
                .prepare(
                    `select n.Id, n.Type, n.Tag, n."Group" as grp, cast(n.ArrivalTime as text) as arrival, cast(n.ExpiryTime as text) as expiry, n.PayloadType, n.Payload,
                            h.PrimaryId as app, h.HandlerType as handlerType
                       from Notification n left join NotificationHandler h on h.RecordId = n.HandlerId`,
                )
                .all();
            db.close();
            const now = new Set();
            for (const r of rows) {
                now.add(String(r.Id));
                if (seen.has(String(r.Id))) continue;
                seen.set(String(r.Id), true);
                if (first) continue;
                const payload = decode(r.Payload);
                log("toasts", "new", { app: r.app, type: r.Type, tag: r.Tag, group: r.grp, arrival: r.arrival, expiry: r.expiry, payloadType: r.PayloadType, payload: clip(payload, 3000) }, true);
            }
            for (const id of [...seen.keys()]) if (!now.has(id)) { seen.delete(id); if (!first) log("toasts", "gone", { id }); }
            if (first) log("toasts", "baseline", { notifications: rows.length });
            first = false;
        } catch (e) {
            log("toasts", "error", { error: String(e).slice(0, 200) });
        }
    };
    poll();
    setInterval(poll, 1000);
}

// Folders of the games themselves: every Epic manifest's InstallLocation, and app-data folders named like the test games.
function gameFolders() {
    const out = [];
    try {
        const dir = join(PROGRAMDATA, "Epic", "EpicGamesLauncher", "Data", "Manifests");
        for (const f of readdirSync(dir)) {
            if (!f.endsWith(".item")) continue;
            const loc = JSON.parse(readFileSync(join(dir, f), "utf8")).InstallLocation;
            if (loc) out.push(loc, join(LOCAL, basename(loc)));
        }
    } catch { /* no Epic */ }
    try {
        for (const e of readdirSync(LOCAL, { withFileTypes: true })) if (e.isDirectory() && /jotunn|hordes|jigsaw|games ?farm|grindstone|ARTillery/i.test(e.name)) out.push(join(LOCAL, e.name));
    } catch { /* ignore */ }
    return out;
}
// ---- files: appends under the stores' folders ---------------------------------------------------------------------------
if (only.has("files")) {
    const pk = (name) => join(LOCAL, "Packages", name);
    const roots = [
        join(LOCAL, "EpicGamesLauncher", "Saved", "Logs"),
        join(LOCAL, "EpicGamesLauncher", "Saved", "Data"),
        join(PROGRAMDATA, "Epic", "EpicGamesLauncher", "Data"),
        join(LOCAL, "EOSOverlay"),
        join(LOCAL, "Epic Games", "EOSOverlay"), // the Epic overlay: cef.log gets a line per toast, BrowserCache a new f_ file per toast image (ADR-0056 research)
        pk("Microsoft.GamingServices_8wekyb3d8bbwe"),
        pk("Microsoft.XboxGamingOverlay_8wekyb3d8bbwe"),
        pk("Microsoft.GamingApp_8wekyb3d8bbwe"),
        pk("Microsoft.XboxIdentityProvider_8wekyb3d8bbwe"),
        pk("Microsoft.MicrosoftJigsaw_8wekyb3d8bbwe"),
        join(LOCAL, "Microsoft", "XboxLive"),
        ...values("--watch"),
        ...gameFolders(),
    ].filter((p, i, all) => existsSync(p) && all.indexOf(p) === i);
    const TEXT = /(\.(log|txt|json|xml|dat|ini|cfg|config|db|sqlite|etl|bin)|[\\/]f_[0-9a-f]{6})$/i;
    const readable = /\.(log|txt|json|xml|ini|cfg|config)$/i;
    const offsets = new Map();
    const lastEvent = new Map();
    const check = (full, announce) => {
        let st;
        try { st = statSync(full); } catch { return; }
        if (!st.isFile() || !TEXT.test(full)) return;
        const prev = offsets.get(full);
        offsets.set(full, st.size);
        if (prev === undefined) {
            if (announce) {
                // A new Chromium cache entry: say what it is (image type and size), the toast's image is one.
                let magic;
                try { const fd = openSync(full, "r"); const b = Buffer.alloc(12); readSync(fd, b, 0, 12, 0); closeSync(fd); magic = b.subarray(0, 4).toString("latin1").startsWith("GIF8") ? `GIF ${b.readUInt16LE(6)}x${b.readUInt16LE(8)}` : b.subarray(0, 4).toString("hex"); } catch { /* locked */ }
                if (/EOSOverlay/i.test(full) && /^GIF/.test(magic ?? "")) candidate("overlay-toast-image", "epic", { magic, size: st.size });
                log("files", "created", { file: full.replace(LOCAL, "%LOCAL%"), size: st.size, magic }, KEYWORDS.test(full) || /EOSOverlay/i.test(full));
            }
            return;
        }
        if (st.size === prev) return;
        const grew = st.size - prev;
        let lines = [];
        if (grew > 0 && readable.test(full) && grew < 2_000_000) {
            try {
                const fd = openSync(full, "r");
                const buf = Buffer.alloc(grew);
                readSync(fd, buf, 0, grew, prev);
                closeSync(fd);
                const text = buf[1] === 0 ? buf.toString("utf16le") : buf.toString("utf8");
                lines = text.split(/\r?\n/).filter(Boolean);
            } catch { /* locked: the size line below still says it changed */ }
        }
        const hotLines = lines.filter((l) => KEYWORDS.test(l) || (/EOSOverlay/i.test(full) && /cef\.log$/i.test(full)));
        const shown = hotLines.length ? hotLines : lines.slice(0, 8);
        if (/EOSOverlay[\\/]cef\.log$/i.test(full)) candidate("overlay-cef-log", "epic", { lines: lines.length });
        log("files", "append", { file: full.replace(LOCAL, "%LOCAL%"), grew, lines: lines.length, text: shown.map((l) => clip(l, 600)) }, hotLines.length > 0);
    };
    for (const root of roots) {
        // baseline: remember sizes, print nothing
        const walk = (d, depth) => {
            try {
                for (const e of require_readdir(d)) {
                    const p = join(d, e.name);
                    if (e.isDirectory() && depth < 4) walk(p, depth + 1);
                    else if (e.isFile()) { try { offsets.set(p, statSync(p).size); } catch { /* gone */ } }
                }
            } catch { /* no access */ }
        };
        walk(root, 0);
        try {
            watch(root, { recursive: true }, (_ev, name) => {
                if (!name) return;
                const full = join(root, name);
                // Windows reports bursts of events per write: handle one per file per 150 ms.
                const now = Date.now();
                if (now - (lastEvent.get(full) ?? 0) < 150) return;
                lastEvent.set(full, now);
                setTimeout(() => check(full, true), 100);
            });
        } catch (e) {
            log("files", "error", { root, error: String(e).slice(0, 120) });
        }
    }
    log("files", "baseline", { roots: roots.map((r) => r.replace(LOCAL, "%LOCAL%")), files: offsets.size });
}
import { readdirSync, readFileSync } from "node:fs";
function require_readdir(d) { return readdirSync(d, { withFileTypes: true }); }

// ---- events: Windows event logs ---------------------------------------------------------------------------------------------
// The PushNotification platform log (readable without admin) records every push Windows receives, WITH ITS PAYLOAD as hex:
// Xbox sends each achievement as a raw push (service "achievements": titleId, name, description, icon, unlock time, gamerscore)
// to the Xbox app's widgets about 1 s after the unlock. The script decodes it and the watcher raises an "xbox-push" candidate.
if (only.has("events")) {
    const script = `
$ErrorActionPreference='SilentlyContinue'
$since = (Get-Date).AddSeconds(-5)
$out = @()
$out += Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-PushNotification-Platform/Operational'; StartTime=$since}
$out += Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=$since} | Where-Object { $_.ProviderName -match 'Xbox|Gaming|Epic|EOS|GameBar|Game Bar|Store' }
$out | Sort-Object TimeCreated | ForEach-Object {
  $m = "$($_.Message)"; $body = $null
  $h = [regex]::Match($m, 'payload: 0x([0-9A-Fa-f]+)')
  if ($h.Success -and $h.Groups[1].Value.Length -lt 20000) { $hex = $h.Groups[1].Value; $b = for ($i = 0; $i -lt $hex.Length; $i += 2) { [Convert]::ToByte($hex.Substring($i, 2), 16) }; $body = [Text.Encoding]::UTF8.GetString($b) }
  [pscustomobject]@{ id=$_.Id; rec=$_.RecordId; log=$_.LogName; provider=$_.ProviderName; time=$_.TimeCreated.ToUniversalTime().ToString('o'); msg=$m.Substring(0,[Math]::Min(500,$m.Length)); payload=$body } } | ConvertTo-Json -Compress`;
    const seen = new Set();
    let first = true;
    const run = () =>
        new Promise((resolve) => {
            const p = spawn("powershell", ["-NoProfile", "-Command", script], { stdio: ["ignore", "pipe", "ignore"] });
            let out = "";
            p.stdout.on("data", (d) => (out += d));
            p.on("close", () => {
                try {
                    const j = JSON.parse(out || "[]");
                    for (const e of Array.isArray(j) ? j : [j]) {
                        const key = `${e.log}:${e.rec}`;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        if (first) continue;
                        const { payload, ...rest } = e;
                        // The achievement push: a JSON body with "service":"achievements".
                        const json = payload ? payload.slice(Math.max(payload.indexOf("{"), 0)) : payload; // the headers end in a blank line (CRLF); the body is the JSON
                        let ach;
                        try { ach = json?.startsWith("{") ? JSON.parse(json) : undefined; } catch { /* not JSON */ }
                        log("events", ach?.service === "achievements" ? "xbox-push" : "event", { ...rest, payload: payload ? clip(payload, 1500) : undefined }, !!ach || KEYWORDS.test(e.msg), e.time);
                        if (ach?.service === "achievements") candidate("xbox-push", "xbox", { title: ach.titleName, titleId: ach.titleId, achievement: ach.achievementName, description: ach.achievementDescription, unlockTime: ach.unlockTime, gamerscore: ach.gamerscore, rarity: ach.rarityCategory });
                    }
                } catch { /* empty poll */ }
                first = false;
                resolve();
            });
        });
    (async () => { for (;;) { await run(); await new Promise((r) => setTimeout(r, 1000)); } })();
}

// ---- api: when does the store itself report the unlock? -------------------------------------------------------------------------
if (only.has("api") && !flag("--no-api")) {
    (async () => {
        let s;
        try {
            s = session((await pick("SharedJSContext")).webSocketDebuggerUrl);
            await s.ready;
        } catch (e) {
            log("api", "off", { why: "no CDP SharedJSContext: " + String(e).slice(0, 100) });
            return;
        }
        const run = async (expression) => (await s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
        // Shortcuts of the "Epic Games" and "Xbox" collections (made by auto-add, ADR-0056), plus --app <appid>:<epic|xbox>.
        const fromCollections = JSON.parse(
            (await run(`JSON.stringify([['Epic Games','epic'],['Xbox','xbox']].flatMap(([name, kind]) => { const c = [...collectionStore.userCollections].find((x) => x.displayName === name); return (c?.allApps ?? []).map((a) => ({ id: a.appid, kind })); }))`)) ?? "[]",
        );
        const targets = [...fromCollections, ...values("--app").map((a) => ({ id: Number(a.split(":")[0]), kind: a.split(":")[1] ?? "epic" }))];
        log("api", "targets", { targets });
        const last = new Map(); // appid -> { key, ids: Map(id -> time) }
        const poll = async (only) => {
            for (const t of targets) {
                if (only && t.kind !== only) continue;
                const res = await run(`(async()=>{ try { const raw = await Millennium.callServerMethod('steam-cartridges-dev','EnsureFresh',{payload: JSON.stringify({appid:${t.id}, parts:['achievements'], context:{force:true, allowEpic:true, allowXbox:true}})});
                  const a = JSON.parse(raw).parts?.achievements; const found = []; const walk = (o) => { if (!o || typeof o !== 'object') return; for (const [k,v] of Object.entries(o)) { if (v && typeof v === 'object' && Number(v.unlocked_time) > 0) found.push(k + '@' + v.unlocked_time); else walk(v); } }; walk(a?.data);
                  return JSON.stringify({ status: a?.status, source: a?.source ?? a?.data?.source, unlocked: found.sort() }); } catch (e) { return JSON.stringify({ error: String(e).slice(0,150) }); } })()`);
                const now = JSON.parse(res ?? "{}");
                const ids = new Map((now.unlocked ?? []).map((u) => u.split("@")).map(([id, at]) => [id, Number(at)]));
                const key = JSON.stringify(now.unlocked ?? now);
                const prev = last.get(t.id);
                if (!prev) log("api", "baseline", { appid: t.id, store: t.kind, status: now.status, source: now.source, unlockedCount: now.unlocked?.length, error: now.error });
                else if (prev.key !== key && now.unlocked) {
                    // The ground truth: which achievements are new, the store's own unlock time, and how late we learned of it.
                    const fresh = [...ids].filter(([id]) => !prev.ids.has(id)).map(([id, at]) => ({ id, at, atIso: new Date(at * 1000).toISOString(), lateSec: +(Date.now() / 1000 - at).toFixed(1) }));
                    log("api", "CHANGED", { appid: t.id, store: t.kind, status: now.status, newUnlocks: fresh, unlockedCount: ids.size, sinceCandidateSec: lastCandidate.at ? +((Date.now() - lastCandidate.at) / 1000).toFixed(1) : null, candidate: lastCandidate.reason }, true);
                }
                if (!prev || now.unlocked) last.set(t.id, { key, ids });
            }
        };
        await poll();
        setInterval(() => poll(), POLL_S * 1000);
        // Burst: after a local candidate, ask the store of that kind every 1.5 s for 20 s (one burst at a time).
        let bursting = false;
        let burstEnd = 0;
        burst = (store) => {
            if (bursting || Date.now() - burstEnd < 10000) return; // one at a time, with a 10 s rest (the Xbox app chats with Xbox Live all day)
            bursting = true;
            const started = Date.now();
            const tick = async () => {
                await poll(store).catch(() => {});
                if (Date.now() - started < 20000) setTimeout(tick, 1500);
                else {
                    bursting = false;
                    burstEnd = Date.now();
                }
            };
            tick();
        };
    })();
}

process.on("SIGINT", () => { log("user", "stop", {}); process.exit(0); });
