// Research tool: turn Epic's in-game achievement toast off by renaming the EOS overlay's renderer (and back).
//
//   node tests/live/probes/epic_overlay.mjs status | mute | restore
//
// The EOS overlay draws its toasts with EOSOverlayRenderer-Win64-Shipping.exe / -Win32-Shipping.exe, installed under
//   C:\Program Files (x86)\Epic Games\Epic Online Services\managedArtifacts\<id>\
// Renaming them to *.bak makes the overlay unable to start (its toast, and its other features such as Shift+Tab, are gone for
// EVERY game using the EOS overlay) while the game and its achievements keep working. Only these two file names are touched.
// It needs an ELEVATED PowerShell (Users only have read access there). Existing renderer processes keep running: mute before
// the game starts. Every rename is written to scratch/epic-overlay-muted.json first, so `restore` can always undo it, even after
// a crash; unlock_watcher.mjs --mute-epic-overlay uses this module and restores on exit.
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.EPIC_OVERLAY_ROOT ?? join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Epic Games", "Epic Online Services", "managedArtifacts");
const NAMES = ["EOSOverlayRenderer-Win64-Shipping.exe", "EOSOverlayRenderer-Win32-Shipping.exe"];
const scratch = join(here, "..", "..", "..", "..", "scratch");
const MARKER = join(scratch, "epic-overlay-muted.json");

/** Every renderer file currently in place (original name) and every one already renamed (.bak). */
export function overlayFiles() {
    const live = [];
    const bak = [];
    if (!existsSync(ROOT)) return { live, bak, root: ROOT, found: false };
    for (const d of readdirSync(ROOT, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        for (const n of NAMES) {
            const p = join(ROOT, d.name, n);
            if (existsSync(p)) live.push(p);
            if (existsSync(p + ".bak")) bak.push(p + ".bak");
        }
    }
    return { live, bak, root: ROOT, found: true };
}

function readMarker() {
    try {
        return JSON.parse(readFileSync(MARKER, "utf8"));
    } catch {
        return [];
    }
}

/** Rename each renderer to .bak. Returns { renamed, errors }. The marker is written before the first rename. */
export function mute() {
    const { live } = overlayFiles();
    const renamed = [];
    const errors = [];
    mkdirSync(scratch, { recursive: true });
    const plan = [...readMarker(), ...live.filter((f) => !existsSync(f + ".bak")).map((f) => ({ from: f, to: f + ".bak" }))];
    writeFileSync(MARKER, JSON.stringify(plan, null, 1));
    for (const f of live) {
        if (existsSync(f + ".bak")) {
            errors.push({ file: f, error: "a .bak already exists (not overwritten)" });
            continue;
        }
        try {
            renameSync(f, f + ".bak");
            renamed.push(f);
        } catch (e) {
            errors.push({ file: f, error: e.code === "EPERM" || e.code === "EACCES" ? "access denied: run this in an ELEVATED PowerShell" : String(e).slice(0, 120) });
        }
    }
    return { renamed, errors };
}

/** Put every renamed file back (from the marker, and any .bak beside an absent original). Synchronous: safe in an exit handler. */
export function restore() {
    const restored = [];
    const errors = [];
    const targets = new Map(); // bak -> original
    for (const m of readMarker()) targets.set(m.to, m.from);
    for (const b of overlayFiles().bak) targets.set(b, b.slice(0, -4));
    for (const [bak, orig] of targets) {
        if (!existsSync(bak)) continue;
        if (existsSync(orig)) {
            errors.push({ file: orig, error: "the original exists again (an Epic update?): left both files alone" });
            continue;
        }
        try {
            renameSync(bak, orig);
            restored.push(orig);
        } catch (e) {
            errors.push({ file: orig, error: e.code === "EPERM" || e.code === "EACCES" ? "access denied: run this in an ELEVATED PowerShell" : String(e).slice(0, 120) });
        }
    }
    if (!errors.length && existsSync(MARKER)) unlinkSync(MARKER);
    return { restored, errors };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const cmd = process.argv[2] ?? "status";
    if (cmd === "status") {
        const { live, bak, root, found } = overlayFiles();
        console.log(found ? `${root}\n  in place : ${live.length ? live.join("\n             ") : "(none)"}\n  renamed  : ${bak.length ? bak.join("\n             ") : "(none)"}` : `not found: ${root}`);
    } else if (cmd === "mute") console.log(JSON.stringify(mute(), null, 1));
    else if (cmd === "restore") console.log(JSON.stringify(restore(), null, 1));
    else console.log("usage: node epic_overlay.mjs status | mute | restore");
}
