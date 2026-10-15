// Architecture guard (migration plan M0c, ADR-0039).
//
// 1. Import ratchet: every import between two different "areas" of frontend/ must be
//    listed in tests/architecture-allowlist.json. A new cross-area import fails the test.
//    An allowlisted edge that no longer exists also fails: delete it from the file, so the
//    list can only shrink. Regenerate after a deliberate change with:
//        ARCH_WRITE_ALLOWLIST=1 npm run test:ts
//    (only a migration plan step may do this, and it must say so).
//    Edges the target layering allows (migration plan § 4.1, LAYER_RULES below, M2) never
//    need the allowlist and must not be in it: the allowlist holds only legacy edges.
// 2. RPC registration: every backend method name ports/backend.ts calls must be assigned
//    as a global in backend/main.lua. Calling an unregistered method crashes the backend
//    host (knowledgebase.md, "Backend RPC crash trap").
// 3. Capability ratchet (M10, ADR-0044): what each layer may DO, not only whom it imports.
//    CAPABILITIES below; the accepted exceptions are in tests/architecture-capabilities-allowlist.json
//    ("<rule> <file>": "<why>"), which only shrinks. Regenerate the keys after a deliberate change with:
//        ARCH_WRITE_CAPABILITIES=1 npm run test:ts
//    (only a migration plan step may do this; every new entry needs its why written by hand).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = join(ROOT, 'frontend');
const ALLOWLIST = join(ROOT, 'tests', 'architecture-allowlist.json');
/** Imports of these files are never counted (shared utilities every area may use). */
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

/** Folders whose children are separate areas: one feature, sensor or surface each. */
const GROUPED = new Set(['sensors', 'surfaces']);

/** "sensors/view", "steam", "kernel", or a root file name ("rpc", "index"). */
export function areaOf(file: string): string {
    const parts = relative(FRONTEND, file).split(sep);
    const stem = (s: string) => s.replace(/\.(ts|tsx)$/, '');
    if (parts.length === 1) return stem(parts[0]);
    if (GROUPED.has(parts[0])) return parts.length === 2 ? `${parts[0]}/${stem(parts[1])}` : `${parts[0]}/${parts[1]}`;
    return parts[0];
}

/**
 * Edges the target layering allows (migration plan § 4.1): [from, to] regexes on areas.
 * Every other cross-area edge must be a legacy edge in the allowlist, which only shrinks.
 */
const LAYER_RULES: [RegExp, RegExp][] = [
    [/^index$/, /./], // composition root: wires everything, holds no logic
    [/^(?!kernel$)/, /^kernel$/], // every layer may use the kernel; the kernel imports nothing of ours
    [/^sensors\//, /^steam$/], // sensors read Steam through steam/ (never another sensor, app or surfaces)
    [/^surfaces\//, /^steam$/], // surfaces write Steam through steam/ (never another surface, app, ports, sensors)
    [/^app$/, /^(domain|ports)$/], // use cases
    [/^settings$/, /^ports$/], // settings panels talk to the backend port only
    [/^(app|settings)$/, /^domain$/], // the pure domain is a leaf like the kernel (M4a)
];

export function ruleAllows(edge: string): boolean {
    const [from, to] = edge.split(' -> ');
    return LAYER_RULES.some(([f, t]) => f.test(from!) && t.test(to!));
}

function resolveImport(from: string, spec: string): string | undefined {
    const base = resolve(dirname(from), spec);
    for (const c of [base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx'), base]) {
        if (existsSync(c) && statSync(c).isFile()) return c;
    }
    return undefined;
}

export function computeEdges(): string[] {
    const edges = new Set<string>();
    for (const file of walk(FRONTEND)) {
        const src = readFileSync(file, 'utf8');
        const re = /(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]/g;
        for (const m of src.matchAll(re)) {
            const target = resolveImport(file, m[1]);
            if (!target) continue;
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
    assert.deepEqual(added, [], `New cross-area imports (not allowed by ADR-0039): ${added.join(', ')}`);
    assert.deepEqual(gone, [], `Allowlisted imports that no longer exist or are allowed by LAYER_RULES; delete them from tests/architecture-allowlist.json: ${gone.join(', ')}`);
});

test('architecture: layer rules allow the § 4.1 edges and nothing it forbids', () => {
    const allowedEdges = ['index -> app', 'app -> kernel', 'sensors/view -> kernel', 'sensors/view -> steam', 'surfaces/sections -> steam', 'app -> ports', 'settings -> ports', 'app -> domain'];
    const forbidden = ['kernel -> steam', 'sensors/view -> sensors/lifecycle', 'sensors/view -> app', 'surfaces/sections -> surfaces/captures', 'surfaces/sections -> app', 'surfaces/sections -> ports', 'app -> steam', 'app -> sensors/view', 'steam -> surfaces/sections', 'domain -> steam'];
    for (const e of allowedEdges) assert.ok(ruleAllows(e), `should be allowed: ${e}`);
    for (const e of forbidden) assert.ok(!ruleAllows(e), `should be forbidden: ${e}`);
});

test('architecture: only game-info imports the scoped overview proxy (guardrail 1)', () => {
    const importers = walk(FRONTEND)
        .filter((f) => /from\s*['"][./]*\/?steam\/overview-proxy['"]/.test(readFileSync(f, 'utf8')))
        .map((f) => areaOf(f))
        .sort();
    assert.deepEqual([...new Set(importers)], ['surfaces/game-info']);
});

test('architecture: every RPC the frontend calls is registered in backend/main.lua', () => {
    const rpcSrc = readFileSync(join(FRONTEND, 'ports', 'backend.ts'), 'utf8');
    const called = new Set<string>();
    for (const m of rpcSrc.matchAll(/(?:>|\bcall)\(\s*['"]([A-Z][A-Za-z0-9]+)['"]/g)) called.add(m[1]);
    const mainLua = readFileSync(join(ROOT, 'backend', 'main.lua'), 'utf8');
    const registered = new Set<string>();
    for (const m of mainLua.matchAll(/^([A-Z][A-Za-z0-9]+)\s*=\s*[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z0-9_]+\s*$/gm)) registered.add(m[1]);
    assert.ok(called.size > 10, `expected to find the ports/backend.ts method names, found ${called.size}`);
    const missing = [...called].filter((n) => !registered.has(n)).sort();
    assert.deepEqual(missing, [], `ports/backend.ts calls methods main.lua does not register: ${missing.join(', ')}`);
});

test('architecture: keepJsxPatched is installed only by steam/gamepad-appid (view sensor), surfaces/native-links and surfaces/community (ADR-0041, ADR-0046; the captures headline and cards moved to steam-captured-activity)', () => {
    const users = walk(FRONTEND)
        .filter((f) => !/steam[\\/]jsx-hook\.ts$/.test(f))
        .filter((f) => /keepJsxPatched\s*\(/.test(readFileSync(f, 'utf8')))
        .map((f) => areaOf(f));
    assert.deepEqual([...new Set(users)].sort(), ['steam', 'surfaces/community', 'surfaces/native-links']);
});

test('architecture: no two surfaces declare the same Steam target (assertDisjointTouches would abort start-up)', () => {
    const owner = new Map<string, string>();
    const dupes: string[] = [];
    for (const dir of readdirSync(join(FRONTEND, 'surfaces'))) {
        for (const name of ['index.ts', 'index.tsx']) {
            const file = join(FRONTEND, 'surfaces', dir, name);
            if (!existsSync(file)) continue;
            const src = readFileSync(file, 'utf8');
            for (const block of src.matchAll(/touches:\s*\[([\s\S]*?)\]/g)) {
                for (const m of block[1]!.replace(/\/\/.*$/gm, '').matchAll(/"([^"]+)"/g)) {
                    const prev = owner.get(m[1]!);
                    if (prev && prev !== dir) dupes.push(`${m[1]} (${prev}, ${dir})`);
                    owner.set(m[1]!, dir);
                }
            }
        }
    }
    assert.ok(owner.size > 20, `expected to read the surfaces' touches, found ${owner.size}`);
    assert.deepEqual(dupes, []);
});

// ---------- 3. Capability ratchet (M10, ADR-0044) ----------

const CAP_ALLOWLIST = join(ROOT, 'tests', 'architecture-capabilities-allowlist.json');
const UNWIRED_RPCS = join(ROOT, 'tests', 'architecture-unwired-rpcs.json');

interface Capability {
    id: string;
    /** Areas (areaOf) the rule applies to. */
    area: RegExp;
    /** What those areas must not contain (comments stripped). */
    forbid: RegExp;
    why: string;
}

/** One rule per row of the layer table (steam-cartridges/README.md, ADR-0044). */
export const CAPABILITIES: Capability[] = [
    { id: 'net', area: /^(?!ports$)/, forbid: /\bfetch\(|XMLHttpRequest|FileReader|wsrv\.nl|callServerMethod/, why: 'network I/O and backend calls only in ports/' },
    { id: 'globals', area: /^(kernel|domain|app|ports)$/, forbid: /(?<!["'\w])window\.|\(window as|SteamClient|(?<!["'\w])document\.|localStorage/, why: 'kernel, domain, app and ports never touch Steam or the browser' },
    { id: 'impure', area: /^(kernel|domain)$/, forbid: /setTimeout|setInterval|Date\.now|new Date\(|\blogger\b|console\./, why: 'kernel and domain are pure' },
    { id: 'patch', area: /^(?!surfaces\/|steam$)/, forbid: /\b(afterPatch|beforePatch|replacePatch)\(/, why: 'only surfaces patch Steam (steam/jsx-hook is the shared dispatcher)' },
    { id: 'detect', area: /^(?!sensors\/|steam$)/, forbid: /\b(onPopupCreate|onLocationChange|onAppLaunch|watchGamepadAppid)\(/, why: 'only sensors detect what the user does' },
    { id: 'webpack', area: /^(?!steam$)/, forbid: /findModuleByExport|findModule\(|webpackChunk|__webpack_require__/, why: 'one webpack scanner, steam/modules.ts (guardrail 3)' },
    { id: 'steam-read', area: /^(index|app|settings)$/, forbid: /\(window as any\)\.(appStore|collectionStore|appDetailsStore|appActivityStore|appAchievementProgressCache|SteamClient)/, why: 'Steam stores are read by sensors' },
    { id: 'appid', area: /^(?!kernel$)/, forbid: />>> 0|\|\s*0\)|0x8000_?0000|<< 32/, why: 'appid math lives in kernel/appid.ts' },
    { id: 'details', area: /./, forbid: /\.details\s*=[^=]/, why: 'guardrail 8: never create or overwrite appData.details' },
    { id: 'backend-value', area: /^(app|domain|sensors\/.+|surfaces\/.+)$/, forbid: /^import \{[^}]*\bbackend\b[^}]*\} from/m, why: 'app/ takes the backend port as a dependency, nothing else reaches it' },
    { id: 'window-event', area: /./, forbid: /new CustomEvent\(|addEventListener\("(steam-cartridges|cartridges):/, why: 'in-process events go through kernel/events.ts' },
    { id: 'module-state', area: /^app$/, forbid: /^(let |const [A-Za-z]+ = new (Map|Set))/m, why: 'app/ modules are create* factories with no module state' },
];

/** Comments out, strings kept: `//` after a `:` or a quote is a URL, not a comment. */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`\\])\/\/.*$/gm, '$1');
}

export function capabilityHits(): string[] {
    const hits = new Set<string>();
    for (const file of walk(FRONTEND)) {
        const area = areaOf(file);
        const src = stripComments(readFileSync(file, 'utf8'));
        const rel = relative(ROOT, file).split(sep).join('/');
        for (const c of CAPABILITIES) if (c.area.test(area) && c.forbid.test(src)) hits.add(`${c.id} ${rel}`);
    }
    return [...hits].sort();
}

test('architecture: no layer does another layer\'s job (capability ratchet, ADR-0044)', () => {
    const hits = capabilityHits();
    if (process.env.ARCH_WRITE_CAPABILITIES === '1') {
        const old: Record<string, string> = existsSync(CAP_ALLOWLIST) ? JSON.parse(readFileSync(CAP_ALLOWLIST, 'utf8')) : {};
        const next: Record<string, string> = {};
        for (const h of hits) next[h] = old[h] ?? 'TODO: why';
        writeFileSync(CAP_ALLOWLIST, JSON.stringify(next, null, 2) + '\n');
    }
    const allowed: Record<string, string> = JSON.parse(readFileSync(CAP_ALLOWLIST, 'utf8'));
    const added = hits.filter((h) => !(h in allowed));
    const gone = Object.keys(allowed).filter((h) => !hits.includes(h));
    const unexplained = Object.entries(allowed).filter(([, why]) => !why || why.startsWith('TODO')).map(([h]) => h);
    const why = (h: string) => CAPABILITIES.find((c) => c.id === h.split(' ')[0])?.why;
    assert.deepEqual(added, [], `A layer does another layer's job: ${added.map((h) => `${h} (${why(h)})`).join('; ')}`);
    assert.deepEqual(gone, [], `Allowed exceptions that no longer exist; delete them from tests/architecture-capabilities-allowlist.json: ${gone.join(', ')}`);
    assert.deepEqual(unexplained, [], `Every allowed exception needs its why: ${unexplained.join(', ')}`);
});

test('architecture: the capability rules catch what they name (ratchet self-test)', () => {
    const net = CAPABILITIES.find((c) => c.id === 'net')!;
    assert.ok(net.area.test('surfaces/artwork') && net.forbid.test('await fetch(url)'), 'a surface fetch is caught');
    assert.ok(!net.area.test('ports'), 'ports may fetch');
    assert.equal(stripComments('// fetch(x)\nconst u = "https://wsrv.nl/";'), '\nconst u = "https://wsrv.nl/";');
    const appid = CAPABILITIES.find((c) => c.id === 'appid')!;
    assert.ok(appid.forbid.test('map.get(a >>> 0) ?? map.get(a | 0)') && !appid.area.test('kernel'));
});

test('architecture: a surface is given no backend call and no other surface (ADR-0044)', () => {
    const index = readFileSync(join(FRONTEND, 'index.tsx'), 'utf8');
    const surfaceNames = new Set<string>();
    for (const m of index.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/surfaces\/[^"]+"/g)) {
        for (const part of m[1]!.split(',')) {
            const name = part.trim().split(/\s+as\s+/).pop()!.replace(/^type\s+/, '');
            if (name && !/^create[A-Z]/.test(name)) surfaceNames.add(name);
        }
    }
    const bad: string[] = [];
    for (const m of index.matchAll(/create([A-Za-z]+)Surface\(([\s\S]*?)\)\s*\)?;/g)) {
        const block = m[2]!;
        if (/\bbackend\./.test(block)) bad.push(`${m[1]}: backend`);
        for (const n of surfaceNames) if (new RegExp(`\\b${n}\\b`).test(block)) bad.push(`${m[1]}: ${n}`);
    }
    assert.ok(surfaceNames.size > 5, `expected to read index.tsx's surface imports, found ${surfaceNames.size}`);
    assert.deepEqual(bad, []);
});

test('architecture: a second listener on another surface\'s Steam method is sanctioned by name (ADR-0042)', () => {
    const SANCTIONED_LISTENERS = ['collectionStore.OnAppOverviewChange#game-info-repair'];
    const bySurface = new Map<string, string[]>();
    for (const dir of readdirSync(join(FRONTEND, 'surfaces'))) {
        const file = join(FRONTEND, 'surfaces', dir, 'index.ts');
        if (!existsSync(file)) continue;
        const touches: string[] = [];
        for (const block of readFileSync(file, 'utf8').matchAll(/touches:\s*\[([\s\S]*?)\]/g)) {
            for (const m of block[1]!.replace(/\/\/.*$/gm, '').matchAll(/"([^"]+)"/g)) touches.push(m[1]!);
        }
        bySurface.set(dir, touches);
    }
    // A `#` name whose base another surface declares is a second listener on that surface's target.
    const listeners: string[] = [];
    for (const [dir, touches] of bySurface) {
        for (const t of touches.filter((x) => x.includes('#'))) {
            const base = t.split('#')[0]!;
            const elsewhere = [...bySurface].some(([other, ts]) => other !== dir && ts.includes(base));
            if (elsewhere) listeners.push(t);
        }
    }
    assert.deepEqual(listeners.sort(), SANCTIONED_LISTENERS);
});

test('architecture: every registered RPC is called by ports/backend.ts or listed as unwired with its plan (D13)', () => {
    const rpcSrc = readFileSync(join(FRONTEND, 'ports', 'backend.ts'), 'utf8');
    const named = new Set([...rpcSrc.matchAll(/["']([A-Z][A-Za-z0-9]+)["']/g)].map((m) => m[1]!));
    const mainLua = readFileSync(join(ROOT, 'backend', 'main.lua'), 'utf8');
    const registered = [...mainLua.matchAll(/^([A-Z][A-Za-z0-9]+)\s*=/gm)].map((m) => m[1]!);
    const unwired: Record<string, string> = JSON.parse(readFileSync(UNWIRED_RPCS, 'utf8'));
    const uncalled = registered.filter((n) => !named.has(n)).sort();
    assert.deepEqual(uncalled, Object.keys(unwired).sort(), 'tests/architecture-unwired-rpcs.json must list exactly the registered RPCs the frontend does not call');
    const methods = [...rpcSrc.matchAll(/^    ([a-z][A-Za-z0-9]+)\(/gm)].map((m) => m[1]!);
    const others = walk(FRONTEND).filter((f) => !/ports[\\/]backend\.ts$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
    const unused = methods.filter((m) => !new RegExp(`\\b${m}\\b`).test(others));
    assert.deepEqual(unused, [], `ports/backend.ts methods nothing calls: ${unused.join(', ')}`);
});

test('architecture: backend services use no RPC module as a library, and no store fetches (ADR-0044)', () => {
    const dir = join(ROOT, 'backend');
    const bad: string[] = [];
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.lua') && n !== 'main.lua')) {
        const src = readFileSync(join(dir, name), 'utf8');
        if (/require\("(web_rpc|steam_store_rpc|record_rpc|achievements_rpc|store_rpc)"\)/.test(src)) bad.push(`${name}: requires an RPC module`);
        if (/(_store|_db)\.lua$|^(fresh_policy|registry)\.lua$/.test(name) && /require\("net"\)/.test(src)) bad.push(`${name}: a store that fetches`);
    }
    assert.deepEqual(bad, []);
});

// 4. ADR-0063: Steam API emulators and local-game sources belong to steam-cartridges-local. The core plugin names none of
//    them, in code, tests or its own docs. This file is the only exception (the pattern below) and is not scanned.
test('architecture: core names no Steam API emulator (ADR-0063)', () => {
    const banned = /\b(rune|codex|skid ?row|empress|reloaded|rld!|sovereign|goldberg|gse|smartsteamemu|online-?fix|tenoke|universelan)\b/i;
    const skip = new Set(['node_modules', '.millennium', '_lib']);
    const self = fileURLToPath(import.meta.url);
    const files: string[] = [];
    const collect = (dir: string) => {
        for (const name of readdirSync(dir)) {
            if (skip.has(name)) continue;
            const p = join(dir, name);
            if (statSync(p).isDirectory()) collect(p);
            else if (/\.(ts|tsx|lua|mjs|js|json|md)$/.test(name) && resolve(p) !== resolve(self)) files.push(p);
        }
    };
    for (const d of ['frontend', 'backend', 'tests']) collect(join(ROOT, d));
    for (const f of ['README.md', 'plugin.json']) if (existsSync(join(ROOT, f))) files.push(join(ROOT, f));
    const hits: string[] = [];
    for (const file of files) {
        readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
            if (banned.test(line)) hits.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 100)}`);
        });
    }
    assert.deepEqual(hits, [], `emulator names in the core plugin:\n${hits.join('\n')}`);
});

test('architecture: surface deps stay singletons used only by their own surface (F30)', () => {
    // Each surfaces/*/deps.ts is a module-level object its create*Surface overwrites: safe while index.tsx creates each
    // surface once and no other folder reaches into it. Rewrite as a factory before ever needing a second instance.
    const index = readFileSync(join(FRONTEND, 'index.tsx'), 'utf8');
    const calls = [...index.matchAll(/\b(create[A-Z]\w*Surface)\s*\(/g)].map((m) => m[1]!);
    const twice = [...new Set(calls.filter((c, i) => calls.indexOf(c) !== i))];
    assert.deepEqual(twice, [], 'a create*Surface called more than once');
    const offenders: string[] = [];
    for (const file of walk(FRONTEND).filter((f) => /\.(ts|tsx)$/.test(f))) {
        const r = relative(FRONTEND, file).split(sep).join('/');
        for (const m of readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]*\/deps)['"]/g)) {
            const target = relative(FRONTEND, resolve(dirname(file), m[1]!)).split(sep).join('/');
            const folder = target.slice(0, target.lastIndexOf('/'));
            if (!r.startsWith(folder + '/')) offenders.push(`${r} -> ${target}`);
        }
    }
    assert.deepEqual(offenders, []);
});
