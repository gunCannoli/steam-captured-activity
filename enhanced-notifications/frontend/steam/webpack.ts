import { logger } from '../logger';

/**
 * Steam's webpack module cache, for resolving exports that
 * `@steambrew/client` cannot reach (it only sees already-evaluated modules).
 *
 * Same technique as steam-cartridges/frontend/steam/modules.ts, kept
 * separate because plugins may not import each other (docs/plugins.md § Layout).
 *
 * NOTHING here resolves by numeric module id: ids reshuffle between Steam
 * builds. Callers match on source text and export shape. Scans run once, at
 * startup (guardrail 3), never in a render path.
 */

interface WebpackRequire {
    (id: string): unknown;
    m: Record<string, { toString(): string }>;
}

let cached: WebpackRequire | null | undefined;

function steamRequire(): WebpackRequire | null {
    if (cached !== undefined) return cached;
    cached = null;
    try {
        const chunks = Reflect.get(globalThis, 'webpackChunksteamui') as unknown[] | undefined;
        if (!Array.isArray(chunks)) return null;
        const key = `__en_probe_${Date.now()}`;
        chunks.push([[key], { [key]: (_m: unknown, _e: unknown, r: WebpackRequire) => (cached = r) }, (r: (id: string) => void) => r(key)]);
    } catch (error) {
        logger.warn("Could not capture Steam's module require:", error);
    }
    return cached;
}

/**
 * Every export (of modules whose factory source passes `sourceFilter`) that
 * satisfies `predicate`. Filtering on source first means only a handful of
 * modules are ever evaluated.
 */
export function findExports(sourceFilter: (src: string) => boolean, predicate: (value: unknown) => boolean): unknown[] {
    const req = steamRequire();
    if (!req) return [];
    const found: unknown[] = [];
    for (const id of Object.keys(req.m)) {
        let src: string;
        try {
            src = req.m[id]!.toString();
        } catch {
            continue;
        }
        if (!sourceFilter(src)) continue;
        let mod: unknown;
        try {
            mod = req(id);
        } catch {
            continue;
        }
        if (!mod || typeof mod !== 'object') continue;
        for (const value of Object.values(mod as Record<string, unknown>)) {
            try {
                if (predicate(value)) found.push(value);
            } catch {
                /* a throwing getter is just not a match */
            }
        }
    }
    return found;
}

/**
 * Module objects (not their exports) matching `predicate`. CSS modules export
 * the class map itself (`{ Title: "_hash Title", ... }`), so they are matched
 * here rather than through findExports.
 */
export function findModules(sourceFilter: (src: string) => boolean, predicate: (mod: Record<string, unknown>) => boolean): Record<string, unknown>[] {
    const req = steamRequire();
    if (!req) return [];
    const found: Record<string, unknown>[] = [];
    for (const id of Object.keys(req.m)) {
        let src: string;
        try {
            src = req.m[id]!.toString();
        } catch {
            continue;
        }
        if (!sourceFilter(src)) continue;
        let mod: unknown;
        try {
            mod = req(id);
        } catch {
            continue;
        }
        if (!mod || typeof mod !== 'object') continue;
        try {
            if (predicate(mod as Record<string, unknown>)) found.push(mod as Record<string, unknown>);
        } catch {
            /* a throwing getter is just not a match */
        }
    }
    return found;
}
