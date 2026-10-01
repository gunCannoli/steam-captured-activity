// One live Steam client, several agents: a lock so only one at a time restarts Steam,
// deploys, or drives the client in a live test. Everyone else waits.
//
//   node steam-lock.mjs status
//   node steam-lock.mjs acquire --owner <id> --purpose "<what>" [--wait <s>] [--ttl <s>]
//   node steam-lock.mjs renew   --owner <id> [--ttl <s>]
//   node steam-lock.mjs release --owner <id> [--force]
//   node steam-lock.mjs run     --owner <id> --purpose "<what>" [--wait <s>] [--ttl <s>] -- <command> [args...]
//
// acquire exits 0 (acquired), 3 (already yours: expiry renewed; do not release it, your
// caller will) or 1 (still held by someone else after --wait). `run` acquires (or reuses
// a lock you hold), runs the command with STEAM_LOCK_OWNER set so nested scripts re-enter
// instead of waiting, and releases only what it acquired.
//
// --owner defaults to $STEAM_LOCK_OWNER. A lock past its expiry (--ttl, default 30 min)
// is taken over: that is the safety net for a holder that was killed. Renew during long
// work. The lock file lives in the OS temp dir, shared by every worktree on this machine.
//
// Scripts import { acquire, release } instead of spawning this file.
import { spawnSync } from "node:child_process";
import { openSync, readFileSync, unlinkSync, writeFileSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const LOCK_FILE = process.env.STEAM_LOCK_FILE ?? join(tmpdir(), "millennium-steam-lock.json");
const DEFAULT_TTL = 1800;

export function read() {
    try {
        return JSON.parse(readFileSync(LOCK_FILE, "utf8"));
    } catch {
        return null;
    }
}

const expired = (lock) => !lock || Date.parse(lock.expiresAt) < Date.now();
const describe = (l) => `"${l.owner}" (${l.purpose || "no purpose given"}) since ${l.acquiredAt}, expires ${l.expiresAt}`;
const record = (owner, purpose, ttl, acquiredAt = new Date().toISOString()) =>
    JSON.stringify({ owner, purpose, acquiredAt, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() }, null, 2);

function tryCreate(owner, purpose, ttl) {
    try {
        const fd = openSync(LOCK_FILE, "wx"); // atomic: fails if the file exists
        writeFileSync(fd, record(owner, purpose, ttl));
        closeSync(fd);
        return true;
    } catch (e) {
        if (e.code === "EEXIST") return false;
        throw e;
    }
}

/** @returns {Promise<"acquired" | "already-yours" | "timeout">} */
export async function acquire({ owner, purpose = "", wait = 900, ttl = DEFAULT_TTL, log = console.log }) {
    if (!owner) throw new Error("acquire needs an owner (--owner or STEAM_LOCK_OWNER)");
    const deadline = Date.now() + wait * 1000;
    let told = false;
    for (;;) {
        if (tryCreate(owner, purpose, ttl)) return "acquired";
        const lock = read();
        if (lock?.owner === owner) {
            writeFileSync(LOCK_FILE, record(owner, lock.purpose || purpose, ttl, lock.acquiredAt));
            return "already-yours";
        }
        if (lock && expired(lock)) {
            log(`steam-lock: taking over an expired lock held by ${describe(lock)}`);
            try {
                unlinkSync(LOCK_FILE);
            } catch {}
            continue; // another waiter may win the create; then we wait like everyone else
        }
        if (Date.now() >= deadline) return "timeout";
        if (!told && lock) {
            log(`steam-lock: Steam is in use by ${describe(lock)}; waiting up to ${wait} s...`);
            told = true;
        }
        await new Promise((ok) => setTimeout(ok, 2000));
    }
}

export function release({ owner, force = false }) {
    const lock = read();
    if (!lock) return "free";
    if (lock.owner !== owner && !force) return "not-yours";
    try {
        unlinkSync(LOCK_FILE);
    } catch {}
    return "released";
}

export function renew({ owner, ttl = DEFAULT_TTL }) {
    const lock = read();
    if (lock?.owner !== owner) return "not-yours";
    writeFileSync(LOCK_FILE, record(owner, lock.purpose, ttl, lock.acquiredAt));
    return "renewed";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const all = process.argv.slice(2);
    const dash = all.indexOf("--");
    const args = dash >= 0 ? all.slice(0, dash) : all;
    const command = dash >= 0 ? all.slice(dash + 1) : [];
    const opt = (name) => {
        const i = args.indexOf(name);
        return i >= 0 ? args[i + 1] : undefined;
    };
    const owner = opt("--owner") ?? process.env.STEAM_LOCK_OWNER;
    const purpose = opt("--purpose") ?? "";
    const wait = Number(opt("--wait") ?? 900);
    const ttl = Number(opt("--ttl") ?? DEFAULT_TTL);

    switch (args[0]) {
        case "status": {
            const lock = read();
            console.log(!lock ? "free" : `${expired(lock) ? "EXPIRED " : ""}held by ${describe(lock)}`);
            break;
        }
        case "acquire": {
            const r = await acquire({ owner, purpose, wait, ttl });
            console.log(`steam-lock: ${r}${r === "timeout" ? `; still held by ${describe(read())}` : ""}`);
            process.exitCode = r === "acquired" ? 0 : r === "already-yours" ? 3 : 1;
            break;
        }
        case "renew":
            console.log(`steam-lock: ${renew({ owner, ttl })}`);
            break;
        case "release": {
            const r = release({ owner, force: args.includes("--force") });
            console.log(`steam-lock: ${r}${r === "not-yours" ? ` (held by ${describe(read())}; --force only if that holder is gone)` : ""}`);
            process.exitCode = r === "not-yours" ? 1 : 0;
            break;
        }
        case "run": {
            if (!command.length) throw new Error("run needs -- <command>");
            const runOwner = owner ?? `run-${process.pid}-${Date.now()}`;
            const r = await acquire({ owner: runOwner, purpose: purpose || command.join(" ").slice(0, 120), wait, ttl });
            if (r === "timeout") {
                console.log(`steam-lock: timeout; still held by ${describe(read())}`);
                process.exitCode = 1;
                break;
            }
            const env = { ...process.env, STEAM_LOCK_OWNER: runOwner };
            let child = spawnSync(command[0], command.slice(1), { stdio: "inherit", env });
            // npm / npx are .cmd shims on Windows and need a shell: pass one quoted line.
            if (child.error && process.platform === "win32") {
                const line = command.map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");
                child = spawnSync(line, { stdio: "inherit", env, shell: true });
            }
            if (r === "acquired") release({ owner: runOwner });
            process.exitCode = child.status ?? 1;
            break;
        }
        default:
            console.log("usage: node steam-lock.mjs status | acquire | renew | release | run  (see the header of this file)");
            process.exitCode = 2;
    }
}
