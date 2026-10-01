// Architecture guard (ADR-0047, same checks as enhanced-achievements' ADR-0043). Runs under `npm test`, no Steam needed.
//
// 1. Import ratchet: every import between two different areas of frontend/ must be
//    allowed by LAYER_RULES or listed in tests/architecture-allowlist.json. A new
//    cross-area import fails; an allowlisted edge that no longer exists also fails
//    (delete it), so the list only shrinks. It starts empty and stays empty.
// 2. Pure files stay pure: their runtime imports resolve only to other pure files
//    (no Steam, SDK, React or logger), so `npm test` can run them under node.
// 3. One owner per Steam write: each pattern that writes into Steam appears in
//    exactly one file (OWNERS).
// 4. Every RPC the frontend calls is registered in backend/main.lua (an
//    unregistered method crashes the backend host; knowledgebase.md).
// 5. Shared copies have not drifted from enhanced-achievements: steam/notification-hook.ts
//    (both plugins wrap the same Steam method with it, so they must compose),
//    kernel/surface.ts, theme/jsonc.ts, settings/rows.tsx, pristineDuration and backend/main.lua (name swapped).
//    Skipped when the sibling plugin is not next to this one.
// 6. Every live script in tests/ is run by tests/run-live.mjs (or listed as a helper).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = join(ROOT, 'frontend');
const SIBLING = join(ROOT, '..', 'enhanced-achievements', 'frontend');
const ALLOWLIST = join(ROOT, 'tests', 'architecture-allowlist.json');
/** Imports of these areas are never counted (shared utilities every area may use). */
const ALWAYS_ALLOWED = new Set(['logger']);

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) out.push(...walk(p));
        else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
}

const rel = (file: string) => relative(FRONTEND, file).split(sep).join('/');

/** Folders whose children are separate areas: one surface each. */
const GROUPED = new Set(['surfaces']);

/** "steam", "theme", "surfaces/sound", or a root file name ("index", "rpc"). */
export function areaOf(file: string): string {
    const parts = rel(file).split('/');
    const stem = (s: string) => s.replace(/\.(ts|tsx)$/, '');
    if (parts.length === 1) return stem(parts[0]!);
    if (GROUPED.has(parts[0]!)) return parts.length === 2 ? `${parts[0]}/${stem(parts[1]!)}` : `${parts[0]}/${parts[1]}`;
    return parts[0]!;
}

/** Edges the layering allows: [from, to] regexes on areas. Every other cross-area edge fails. */
const LAYER_RULES: [RegExp, RegExp][] = [
    [/^index$/, /./], // the composition root wires everything
    [/^(?!safety$|kernel$)/, /^safety$/], // every layer may use the kill switches; safety and kernel import nothing of ours
    [/^(?!kernel$|safety$)/, /^kernel$/], // every layer may use the kernel contracts
    [/^theme$/, /^(rpc|settings)$/], // active-theme.ts loads through RPC and follows the theme setting
    [/^settings$/, /^(rpc|theme|steam)$/], // previews are injected as a prop; steam is the read-only toasts-off flag and claims()
    [/^surfaces\//, /^(steam|theme|settings)$/],
];

export function ruleAllows(edge: string): boolean {
    const [from, to] = edge.split(' -> ');
    return LAYER_RULES.some(([f, t]) => f.test(from!) && t.test(to!));
}

function resolveImport(from: string, spec: string): string | undefined {
    const base = resolve(dirname(from), spec);
    for (const c of [base, base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')]) {
        if (existsSync(c) && statSync(c).isFile()) return c;
    }
    return undefined;
}

interface Import {
    target: string;
    typeOnly: boolean;
}

function importsOf(file: string): { local: Import[]; bare: string[] } {
    const src = readFileSync(file, 'utf8');
    const local: Import[] = [];
    const bare: string[] = [];
    for (const m of src.matchAll(/(?:^|\n)\s*(import|export)\s+(type\s+)?[^'"]*?from\s*['"]([^'"]+)['"]/g)) {
        const spec = m[3]!;
        if (!spec.startsWith('.')) {
            if (!m[2]) bare.push(spec);
            continue;
        }
        const target = resolveImport(file, spec);
        if (target) local.push({ target, typeOnly: !!m[2] });
    }
    return { local, bare };
}

export function computeEdges(): string[] {
    const edges = new Set<string>();
    for (const file of walk(FRONTEND)) {
        for (const { target } of importsOf(file).local) {
            if (!target.startsWith(FRONTEND)) continue; // settings.json and other non-frontend files
            const a = areaOf(file);
            const b = areaOf(target);
            if (a === b || ALWAYS_ALLOWED.has(b)) continue;
            edges.add(`${a} -> ${b}`);
        }
    }
    return [...edges].sort();
}

test('architecture: no new cross-area import (ratchet)', () => {
    const edges = computeEdges();
    if (process.env.ARCH_WRITE_ALLOWLIST === '1') {
        writeFileSync(ALLOWLIST, JSON.stringify(edges.filter((e) => !ruleAllows(e)), null, 2) + '\n');
    }
    const allowed: string[] = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
    const added = edges.filter((e) => !ruleAllows(e) && !allowed.includes(e));
    const gone = allowed.filter((e) => !edges.includes(e) || ruleAllows(e));
    assert.deepEqual(added, [], `New cross-area imports: ${added.join(', ')}`);
    assert.deepEqual(gone, [], `Allowlisted imports that no longer exist or are now allowed; delete them from tests/architecture-allowlist.json: ${gone.join(', ')}`);
});

/** Files `npm test` runs under node: no Steam, SDK, React or logger. */
export const PURE = [
    'kernel/notification.ts',
    'kernel/surface.ts',
    'kernel/toast-selectors.ts',
    'safety/boot.ts',
    'safety/features.ts',
    'safety/runtime.ts',
    'steam/notification-hook.ts',
    'surfaces/duration/duration.ts',
    'surfaces/preview/pick.ts',
    'surfaces/sound/sound.ts',
    'theme/jsonc.ts',
    'theme/placement.ts',
    'theme/theme.ts',
];

test('architecture: layer rules allow the intended edges and nothing they forbid', () => {
    const allowed = ['index -> surfaces/style', 'surfaces/sound -> steam', 'surfaces/duration -> theme', 'settings -> steam', 'theme -> rpc', 'steam -> kernel', 'theme -> kernel'];
    const forbidden = [
        'surfaces/style -> surfaces/sound',
        'steam -> surfaces/style',
        'steam -> theme',
        'steam -> settings',
        'kernel -> steam',
        'kernel -> safety',
        'safety -> kernel',
        'settings -> surfaces/preview',
        'theme -> steam',
    ];
    assert.deepEqual(allowed.filter((e) => !ruleAllows(e)), [], 'edges the layering must allow');
    assert.deepEqual(forbidden.filter((e) => ruleAllows(e)), [], 'edges the layering must forbid');
});

test('architecture: pure files import only other pure files at runtime', () => {
    const bad: string[] = [];
    for (const file of PURE) {
        const abs = join(FRONTEND, file);
        assert.ok(existsSync(abs), `PURE lists a file that does not exist: ${file}`);
        const { local, bare } = importsOf(abs);
        for (const spec of bare) bad.push(`${file} -> ${spec}`);
        for (const imp of local) if (!imp.typeOnly && !PURE.includes(rel(imp.target))) bad.push(`${file} -> ${rel(imp.target)}`);
    }
    assert.deepEqual(bad, []);
});

/** Each Steam write pattern and the one file allowed to contain it. */
export const OWNERS: [string, RegExp, string][] = [
    ['NotificationStore.prototype.PlayNotificationSound', /\.PlayNotificationSound\s*=(?!=)/, 'steam/notification-hook.ts'],
    ['NotificationStore ChooseSound (per call)', /\.ChooseSound\s*=(?!=)/, 'steam/notification-hook.ts'],
    ['type config toastDurationMS', /\.toastDurationMS\s*=(?!=)/, 'surfaces/duration/index.ts'],
    ['toast popup SteamClient.Window.MoveTo', /\.MoveTo\s*=(?!=)/, 'surfaces/style/toast-window.ts'],
    ['toast window body[data-en-type]', /\.setAttribute\(\s*'data-en-type'/, 'surfaces/style/injector.ts'],
    ['Millennium.AddWindowCreateHook (toast windows)', /\.AddWindowCreateHook\s*\(/, 'surfaces/style/injector.ts'],
    ["NotificationStore test toasts (previews)", /\.Test[A-Z]\w*\?\.\(/, 'surfaces/preview/index.ts'],
];

test('architecture: one owner per Steam write', () => {
    const wrong: string[] = [];
    for (const [target, pattern, owner] of OWNERS) {
        const writers = walk(FRONTEND)
            .filter((f) => pattern.test(readFileSync(f, 'utf8')))
            .map(rel);
        if (writers.length !== 1 || writers[0] !== owner) wrong.push(`${target}: expected only ${owner}, found [${writers.join(', ')}]`);
    }
    assert.deepEqual(wrong, []);
});

test('architecture: no two surfaces declare the same Steam target', () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    const dirs = readdirSync(join(FRONTEND, 'surfaces'), { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const dir of dirs) {
        const src = readFileSync(join(FRONTEND, 'surfaces', dir.name, 'index.ts'), 'utf8');
        for (const block of src.matchAll(/touches:\s*\[([\s\S]*?)\]/g)) {
            for (const m of block[1]!.replace(/\/\/.*$/gm, '').matchAll(/'([^']+)'/g)) {
                const target = m[1]!;
                const first = owner.get(target);
                if (first !== undefined && first !== dir.name) clashes.push(`${target}: ${first} and ${dir.name}`);
                owner.set(target, dir.name);
            }
        }
    }
    assert.equal(dirs.length, 4, 'expected the four surfaces');
    assert.ok(owner.size >= 5, `expected to read the surfaces' touches, found ${owner.size}`);
    assert.deepEqual(clashes, []);
});

test('architecture: every RPC the frontend calls is registered in backend/main.lua', () => {
    const rpcSrc = readFileSync(join(FRONTEND, 'rpc.ts'), 'utf8');
    const called = new Set([...rpcSrc.matchAll(/>\(\s*'([A-Z][A-Za-z0-9]+)'/g)].map((m) => m[1]!));
    const mainLua = readFileSync(join(ROOT, 'backend', 'main.lua'), 'utf8');
    const registered = new Set([...mainLua.matchAll(/^([A-Z][A-Za-z0-9]+)\s*=\s*method\(/gm)].map((m) => m[1]!));
    assert.equal(called.size, 4, `expected the four rpc.ts method names, found ${[...called].join(', ')}`);
    assert.deepEqual([...called].filter((n) => !registered.has(n)), []);
});

for (const file of ['steam/notification-hook.ts', 'kernel/surface.ts', 'theme/jsonc.ts', 'settings/rows.tsx']) {
    test(`architecture: ${file} is identical to the enhanced-achievements copy`, (t) => {
        const sibling = join(SIBLING, file);
        if (!existsSync(sibling)) return t.skip('enhanced-achievements is not next to this plugin');
        assert.equal(readFileSync(join(FRONTEND, file), 'utf8'), readFileSync(sibling, 'utf8'));
    });
}

test('architecture: pristineDuration is identical to the enhanced-achievements copy', (t) => {
    if (!existsSync(SIBLING)) return t.skip('enhanced-achievements is not next to this plugin');
    const fn = (src: string) => src.match(/function pristineDuration[\s\S]*?\n}\n/)?.[0];
    const ours = walk(FRONTEND).map((f) => fn(readFileSync(f, 'utf8'))).filter(Boolean);
    const theirs = walk(SIBLING).map((f) => fn(readFileSync(f, 'utf8'))).filter(Boolean);
    assert.equal(ours.length, 1, 'expected exactly one pristineDuration in frontend/');
    assert.equal(theirs.length, 1, 'expected exactly one pristineDuration in enhanced-achievements/frontend/');
    assert.equal(ours[0], theirs[0]);
});

test('architecture: backend/main.lua is the enhanced-achievements copy with the plugin name swapped', (t) => {
    const sibling = join(ROOT, '..', 'enhanced-achievements', 'backend', 'main.lua');
    if (!existsSync(sibling)) return t.skip('enhanced-achievements is not next to this plugin');
    const theirs = readFileSync(sibling, 'utf8').split('enhanced-achievements').join('enhanced-notifications');
    assert.equal(readFileSync(join(ROOT, 'backend', 'main.lua'), 'utf8'), theirs);
});

/** Live scripts that are helpers, not checks. */
const LIVE_HELPERS = ['cdp.mjs', 'console.mjs', 'reload.mjs', 'run-live.mjs'];

test('architecture: every live check is run by tests/run-live.mjs', () => {
    const runner = readFileSync(join(ROOT, 'tests', 'run-live.mjs'), 'utf8');
    const scripts = readdirSync(join(ROOT, 'tests')).filter((n) => n.endsWith('.mjs') && !LIVE_HELPERS.includes(n));
    assert.deepEqual(scripts.filter((n) => !runner.includes(`'${n}'`)), []);
});
