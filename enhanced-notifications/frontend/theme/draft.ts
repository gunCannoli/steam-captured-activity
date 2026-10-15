/**
 * The Theme Creator's theme document (theme creator plan § 6.5, D3): the raw theme JSON, edited by path, so the preview
 * runs the plugin's own `resolveTheme` on exactly what will be saved and unknown keys survive a round trip.
 *
 * - `getAt` / `setAt` / `unsetAt` edit by path and return a new object (unset prunes the objects it empties).
 * - `modePath`: the same key in the Big Picture look lives under `bigpicture` (ADR-0068).
 * - `originOf`: where a key's value comes from (set here, the desktop look, an inherited tier layer, or Steam's own).
 * - `createHistory` / `push` / `undo` / `redo`: 100 snapshots.
 * - `serialize`: the JSONC the creator writes (fixed key order, tuples on one line).
 * - `assetPathsOf` / `copyPlan`: every file the theme uses, and what Save copies where (§ 6.6).
 *
 * Pure: no Steam, SDK or React (tests/draft.test.ts).
 */
import { BANNER_KEYS, TIERS, type Tier } from './achievements.ts';
import { mergeOverride, type ThemeMode } from './theme.ts';

export type Json = Record<string, unknown>;
export type Path = readonly string[];

function isObject(v: unknown): v is Json {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

// --- paths ---------------------------------------------------------------------------------------

export function getAt(raw: unknown, path: Path): unknown {
    let node: unknown = raw;
    for (const key of path) {
        if (!isObject(node)) return undefined;
        node = node[key];
    }
    return node;
}

/** `raw` with `value` at `path`; missing (or non-object) parents become objects. `undefined` unsets. */
export function setAt(raw: Json, path: Path, value: unknown): Json {
    if (value === undefined) return unsetAt(raw, path);
    if (path.length === 0) return isObject(value) ? value : raw;
    const [head, ...rest] = path as [string, ...string[]];
    const child = isObject(raw[head]) ? (raw[head] as Json) : {};
    return { ...raw, [head]: rest.length ? setAt(child, rest, value) : value };
}

/** `raw` without the key at `path`; an object left empty by it is removed too. Unchanged when the key is not there. */
export function unsetAt(raw: Json, path: Path): Json {
    if (path.length === 0) return raw;
    const [head, ...rest] = path as [string, ...string[]];
    if (!(head in raw)) return raw;
    const out = { ...raw };
    if (rest.length === 0) delete out[head];
    else {
        if (!isObject(raw[head])) return raw;
        const child = unsetAt(raw[head] as Json, rest);
        if (Object.keys(child).length === 0) delete out[head];
        else out[head] = child;
    }
    return out;
}

/** Where a key lives in the document for a mode: Big Picture keys sit under `bigpicture` (ADR-0068). */
export function modePath(mode: ThemeMode, path: Path): Path {
    return mode === 'bigpicture' ? ['bigpicture', ...path] : path;
}

/** The theme as that mode sees it: the `bigpicture` block merged over the rest in Big Picture. */
export function viewOf(raw: Json, mode: ThemeMode): Json {
    const { bigpicture, ...rest } = raw;
    return mode === 'bigpicture' && isObject(bigpicture) ? mergeOverride(rest, bigpicture) : rest;
}

// --- where a value comes from ---------------------------------------------------------------------

export type Origin =
    /** Set in this mode's own keys (`null` in Big Picture = Steam's own there, set on purpose). */
    | { kind: 'set'; value: unknown }
    /** Big Picture only: not set there, so the desktop look's value. */
    | { kind: 'desktop'; value: unknown }
    /** An achievement tier key not set on the tier: from Normal, from the block ("All tiers"), or from the card. */
    | { kind: 'inherited'; from: 'Normal' | 'All tiers' | 'Card'; value: unknown }
    | { kind: 'steam' };

const BANNER_KEY_SET = new Set<string>(BANNER_KEYS);

/**
 * The layers a key falls back through when it is not set: for `achievements.<tier>.<key>`, the Normal tier (not for
 * `threshold`, never inherited), then for a banner key the block's own key and the card's (`popup.<key>`). Pure.
 */
function fallbacks(path: Path): { from: 'Normal' | 'All tiers' | 'Card'; path: Path }[] {
    if (path[0] !== 'achievements' || path.length < 3 || !TIERS.includes(path[1] as Tier)) return [];
    const [, tier, key, ...rest] = path as [string, string, string, ...string[]];
    const out: { from: 'Normal' | 'All tiers' | 'Card'; path: Path }[] = [];
    if (tier !== 'normal' && key !== 'threshold') out.push({ from: 'Normal', path: ['achievements', 'normal', key, ...rest] });
    if (BANNER_KEY_SET.has(key) && rest.length === 0) {
        out.push({ from: 'All tiers', path: ['achievements', key] }, { from: 'Card', path: ['popup', key] });
    }
    return out;
}

/** Where the value of `path` (a desktop-shaped path) comes from in `mode`. */
export function originOf(raw: Json, mode: ThemeMode, path: Path): Origin {
    const own = getAt(raw, modePath(mode, path));
    if (own !== undefined) return { kind: 'set', value: own };
    if (mode === 'bigpicture') {
        const desktop = getAt(raw, path);
        if (desktop !== undefined) return { kind: 'desktop', value: desktop };
    }
    const view = viewOf(raw, mode);
    for (const layer of fallbacks(path)) {
        const value = getAt(view, layer.path);
        if (value !== undefined && value !== null) return { kind: 'inherited', from: layer.from, value };
    }
    return { kind: 'steam' };
}

/** The value a control shows for `path` in `mode` (whatever its origin); undefined = Steam's own. */
export function effectiveValue(raw: Json, mode: ThemeMode, path: Path): unknown {
    const o = originOf(raw, mode, path);
    return o.kind === 'steam' ? undefined : (o.value ?? undefined);
}

// --- history ---------------------------------------------------------------------------------------

export const HISTORY_DEPTH = 100;

/** Snapshots of anything immutable (the raw theme, or a whole draft). */
export interface History<T = Json> {
    past: T[];
    present: T;
    future: T[];
}

export function createHistory<T = Json>(present: T): History<T> {
    return { past: [], present, future: [] };
}

/** A new present; the redo list is dropped. The same object again is no step. */
export function push<T>(h: History<T>, next: T): History<T> {
    if (next === h.present) return h;
    return { past: [...h.past, h.present].slice(-HISTORY_DEPTH), present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
    if (!h.past.length) return h;
    return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
    if (!h.future.length) return h;
    return { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) };
}

// --- JSONC out -------------------------------------------------------------------------------------

/** Keys in this order first (the order of themes.md), then any other key in the order it has. */
const ORDER: Record<string, readonly string[]> = {
    '': ['settings', 'popup', 'text', 'font_family', 'popup_icon', 'header_icon', 'sound', 'achievements', 'bigpicture'],
    settings: ['position', 'animation', 'display_time_ms', 'text_align', 'hover'],
    popup: ['background', 'gradient_angle', 'border', 'glow', 'watermark', 'margin', 'padding', 'gap', 'scale', 'width', 'height', 'layout'],
    text: ['title', 'body', 'subtext'],
    achievements: ['layout', ...BANNER_KEYS, ...TIERS],
    tier: ['threshold', ...BANNER_KEYS, 'icons', 'sound', 'text'],
    icons: ['achievement', 'system', 'rarity'],
};

function orderFor(path: Path): readonly string[] {
    const last = path[path.length - 1] ?? '';
    if (last === 'bigpicture') return ORDER['']!;
    if (path.length >= 2 && path[path.length - 2] === 'achievements' && TIERS.includes(last as Tier)) return ORDER.tier!;
    return ORDER[last] ?? [];
}

function sortedKeys(obj: Json, path: Path): string[] {
    const order = orderFor(path);
    const keys = Object.keys(obj);
    const known = order.filter((k) => keys.includes(k));
    return [...known, ...keys.filter((k) => !order.includes(k))];
}

function write(value: unknown, path: Path, indent: string): string {
    if (Array.isArray(value)) {
        // A tuple or a colour list stays on one line; a list holding objects is laid out like an object.
        if (value.every((v) => !isObject(v) && !Array.isArray(v))) return `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
        const inner = indent + '    ';
        return `[\n${value.map((v) => inner + write(v, path, inner)).join(',\n')}\n${indent}]`;
    }
    if (isObject(value)) {
        const keys = sortedKeys(value, path);
        if (!keys.length) return '{}';
        const inner = indent + '    ';
        return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${write(value[k], [...path, k], inner)}`).join(',\n')}\n${indent}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

/** The theme as the creator writes it: a header comment, then formatted JSON (valid JSONC and JSON). */
export function serialize(raw: Json): string {
    return `// Made with the Theme Creator (enhanced-notifications). Format: themes.md.\n${write(raw, [], '')}\n`;
}

// --- assets ----------------------------------------------------------------------------------------

/** Where an asset path sits in the document, so Save can rewrite it. */
type AssetRef = { path: Path; index: number | null };

/** Every place a theme names a file: the notification sound and, per tier, its sound and icon slots; both looks. */
function assetRefs(raw: Json): { file: string; ref: AssetRef }[] {
    const out: { file: string; ref: AssetRef }[] = [];
    const tupleOrString = (base: Path, v: unknown) => {
        if (typeof v === 'string' && v) out.push({ file: v, ref: { path: base, index: null } });
        else if (Array.isArray(v) && typeof v[0] === 'string' && v[0]) out.push({ file: v[0], ref: { path: base, index: 0 } });
    };
    for (const prefix of [[], ['bigpicture']] as Path[]) {
        const look = getAt(raw, prefix);
        if (!isObject(look)) continue;
        tupleOrString([...prefix, 'sound'], look.sound);
        const block = look.achievements;
        if (!isObject(block)) continue;
        for (const tier of TIERS) {
            const t = block[tier];
            if (!isObject(t)) continue;
            tupleOrString([...prefix, 'achievements', tier, 'sound'], t.sound);
            if (isObject(t.icons)) for (const slot of ['achievement', 'system', 'rarity']) tupleOrString([...prefix, 'achievements', tier, 'icons', slot], t.icons[slot]);
        }
    }
    return out;
}

/** Every distinct file the theme names, in document order. */
export function assetPathsOf(raw: Json): string[] {
    return [...new Set(assetRefs(raw).map((a) => a.file))];
}

export function isAbsolutePath(p: string): boolean {
    return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\');
}

/** A library cue the draft uses but has not saved yet (plan § 5.4). */
export interface LibraryPick {
    kind: 'library';
    pack: string;
    cue: string;
}

/** A file the user picked with Steam's file dialog (an absolute path), copied into the theme's folder on Save. */
export interface FilePick {
    kind: 'file';
    path: string;
}

export type PendingCopy = LibraryPick | FilePick;

/** The draft: its file name, where it came from, the raw theme, and the library cues still to copy. */
export interface CreatorDraft {
    /** File stem, `NAME_PATTERN`. */
    name: string;
    origin: { kind: 'fresh' } | { kind: 'template' | 'user'; id: string; dir: string; hadComments: boolean };
    raw: Json;
    /** Path in `raw` -> what it stands for until saved: a library cue (`sounds/<pack>/<cue>.wav`) or a picked file (its absolute path). */
    pendingCopies: Record<string, PendingCopy>;
}

export const NAME_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

/** The path a library cue has in a draft until it is saved: relative to the bundled themes folder. */
export function libraryPath(pack: string, cue: string): string {
    return `sounds/${pack}/${cue}.wav`;
}

export interface CopyStep {
    /** Which root `path` is relative to; `file`: `path` is the absolute path the user picked. */
    from: 'bundled' | 'user' | 'library' | 'file';
    path: string;
    /** Relative to the user themes folder: always `<name>/<file>`. */
    to: string;
}

function basename(p: string): string {
    return p.split(/[\\/]/).pop() || 'file';
}

/**
 * What Save writes (plan § 6.6, D2): every relative file the theme names that is not already in `<name>/` of the same
 * user theme is copied to `<name>/<file>` (a clash gets `-2`, `-3`, ...) and its path rewritten; a library cue becomes
 * `<name>/<pack>_<cue>.wav`; a picked file is copied under its own name; other absolute paths stay as they are. A fresh theme's relative paths already point into the
 * user folder and stay. Returns the rewritten document and the copies, in order.
 */
export function copyPlan(draft: CreatorDraft): { raw: Json; copies: CopyStep[] } {
    const { name, origin, pendingCopies } = draft;
    const taken = new Set<string>();
    const moved = new Map<string, string>(); // old path -> new path
    const copies: CopyStep[] = [];
    const claim = (file: string) => {
        const dot = file.lastIndexOf('.');
        const stem = dot > 0 ? file.slice(0, dot) : file;
        const ext = dot > 0 ? file.slice(dot) : '';
        let candidate = file;
        for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}${ext}`;
        taken.add(candidate.toLowerCase());
        return `${name}/${candidate}`;
    };
    const refs = assetRefs(draft.raw);
    // Files already in place keep their names, so a copy never takes one.
    for (const { file } of refs) {
        if (origin.kind === 'user' && origin.id === name && file.startsWith(`${name}/`) && !pendingCopies[file]) taken.add(file.slice(name.length + 1).toLowerCase());
    }
    for (const { file } of refs) {
        if (moved.has(file)) continue;
        const pick = pendingCopies[file];
        if (pick?.kind === 'library') {
            const to = claim(`${pick.pack}_${pick.cue}.wav`);
            moved.set(file, to);
            copies.push({ from: 'library', path: libraryPath(pick.pack, pick.cue), to });
            continue;
        }
        if (pick?.kind === 'file') {
            const to = claim(basename(pick.path));
            moved.set(file, to);
            copies.push({ from: 'file', path: pick.path, to });
            continue;
        }
        if (isAbsolutePath(file)) continue;
        if (origin.kind === 'fresh') continue;
        if (origin.kind === 'user' && origin.id === name && file.startsWith(`${name}/`)) continue;
        const to = claim(basename(file));
        moved.set(file, to);
        copies.push({ from: origin.kind === 'template' ? 'bundled' : 'user', path: file, to });
    }
    let raw = draft.raw;
    for (const { file, ref } of refs) {
        const to = moved.get(file);
        if (!to) continue;
        const current = getAt(raw, ref.path);
        raw = setAt(raw, ref.path, ref.index === null ? to : (current as unknown[]).map((v, i) => (i === ref.index ? to : v)));
    }
    return { raw, copies };
}
