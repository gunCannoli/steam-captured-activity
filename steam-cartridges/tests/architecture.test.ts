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
// 2. RPC registration: every backend method name frontend/rpc.ts calls must be assigned
//    as a global in backend/main.lua. Calling an unregistered method crashes the backend
//    host (knowledgebase.md, "Backend RPC crash trap").
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
const GROUPED = new Set(['features', 'sensors', 'surfaces']);

/** "features/game-info", "sensors/view", "steam", "kernel", or a root file name ("rpc", "index"). */
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
    [/^(app|settings|features\/.+)$/, /^domain$/], // the pure domain is a leaf like the kernel (M4a)
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
    const allowedEdges = ['index -> features/game-info', 'app -> kernel', 'sensors/view -> kernel', 'sensors/view -> steam', 'surfaces/sections -> steam', 'app -> ports', 'settings -> ports', 'features/scraper -> domain'];
    const forbidden = ['kernel -> steam', 'sensors/view -> sensors/lifecycle', 'sensors/view -> app', 'surfaces/sections -> surfaces/captures', 'surfaces/sections -> app', 'surfaces/sections -> ports', 'app -> steam', 'app -> sensors/view', 'features/game-info -> sensors/collections', 'steam -> surfaces/sections', 'domain -> steam'];
    for (const e of allowedEdges) assert.ok(ruleAllows(e), `should be allowed: ${e}`);
    for (const e of forbidden) assert.ok(!ruleAllows(e), `should be forbidden: ${e}`);
});

test('architecture: only game-info and playbar import the scoped overview proxy (guardrail 1)', () => {
    const importers = walk(FRONTEND)
        .filter((f) => /from\s*['"][./]*\/?steam\/overview-proxy['"]/.test(readFileSync(f, 'utf8')))
        .map((f) => areaOf(f))
        .sort();
    assert.deepEqual([...new Set(importers)], ['surfaces/game-info', 'surfaces/playbar']);
});

test('architecture: every RPC the frontend calls is registered in backend/main.lua', () => {
    const rpcSrc = readFileSync(join(FRONTEND, 'rpc.ts'), 'utf8');
    const called = new Set<string>();
    for (const m of rpcSrc.matchAll(/(?:>|\bcall)\(\s*['"]([A-Z][A-Za-z0-9]+)['"]/g)) called.add(m[1]);
    const mainLua = readFileSync(join(ROOT, 'backend', 'main.lua'), 'utf8');
    const registered = new Set<string>();
    for (const m of mainLua.matchAll(/^([A-Z][A-Za-z0-9]+)\s*=\s*[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z0-9_]+\s*$/gm)) registered.add(m[1]);
    assert.ok(called.size > 10, `expected to find the rpc.ts method names, found ${called.size}`);
    const missing = [...called].filter((n) => !registered.has(n)).sort();
    assert.deepEqual(missing, [], `rpc.ts calls methods main.lua does not register: ${missing.join(', ')}`);
});
