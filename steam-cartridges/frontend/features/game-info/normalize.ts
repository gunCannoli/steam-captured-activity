/**
 * Metadata shape guard (P4 H1). Millennium's Lua `json.encode` writes an empty
 * table as `{}`, so list fields in library_metadata.json and in backend replies
 * can arrive as objects (14 `franchises: {}` entries on the dev machine). Code
 * that calls `.join` on them throws. Pure, `import type` only, so Node can run
 * the unit tests with type stripping.
 */
import type { ConsolidatedMetadata } from '../../rpc';

function strings(v: unknown): string[] {
    if (typeof v === 'string') return v ? [v] : [];
    const list = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v as Record<string, unknown>) : [];
    return list.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

function seconds(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Every list field becomes a string array; dates become numbers (0 = unknown). */
export function normalizeMetadata(meta: ConsolidatedMetadata): ConsolidatedMetadata {
    return {
        ...meta,
        developers: strings(meta.developers),
        publishers: strings(meta.publishers),
        franchises: strings(meta.franchises),
        genres: strings(meta.genres),
        release_date: seconds(meta.release_date),
        original_release_date: seconds(meta.original_release_date),
    };
}
