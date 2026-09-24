/**
 * Pure bucket resolution (ADR-0033). No runtime imports, so Node can run the
 * unit tests with type stripping.
 */
export type Bucket = 'steam-store' | 'web-scraping' | 'none';

export interface BucketAssignment {
    id: string;
    name: string;
    bucket: Exclude<Bucket, 'none'>;
}

export interface BucketsConfig {
    version: 1;
    default: 'none';
    /** ORDER = precedence; a collection id appears once. */
    assignments: BucketAssignment[];
    /** Shortcut appid (string) -> bucket. Shortcuts only: no native data is persisted. */
    overrides: Record<string, Bucket>;
}

export interface Resolution {
    bucket: Bucket;
    via: 'override' | 'collection' | 'default' | 'not-a-shortcut';
    collectionId?: string;
    conflict?: { collectionIds: string[]; buckets: Bucket[] };
}

export type MembersOf = (collectionId: string) => ReadonlySet<number> | undefined;

export const SHORTCUT_MIN = 0x8000_0000;

export const DEFAULT_BUCKETS: BucketsConfig = { version: 1, default: 'none', assignments: [], overrides: {} };

const isBucket = (v: unknown): v is Bucket => v === 'steam-store' || v === 'web-scraping' || v === 'none';

/** Never throws. Drops malformed entries; forces `default: 'none'`. */
export function validateConfig(raw: unknown): BucketsConfig {
    const out: BucketsConfig = { version: 1, default: 'none', assignments: [], overrides: {} };
    if (!raw || typeof raw !== 'object') return out;
    const r = raw as Record<string, unknown>;

    if (Array.isArray(r.assignments)) {
        const seen = new Set<string>();
        for (const a of r.assignments) {
            if (!a || typeof a !== 'object') continue;
            const { id, name, bucket } = a as Record<string, unknown>;
            if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
            if (bucket !== 'steam-store' && bucket !== 'web-scraping') continue;
            seen.add(id);
            out.assignments.push({ id, name: typeof name === 'string' ? name : id, bucket });
        }
    }

    if (r.overrides && typeof r.overrides === 'object' && !Array.isArray(r.overrides)) {
        for (const [key, bucket] of Object.entries(r.overrides)) {
            if (!/^\d+$/.test(key) || Number(key) < SHORTCUT_MIN || !isBucket(bucket)) continue;
            out.overrides[key] = bucket;
        }
    }
    return out;
}

export function resolveBucket(appid: number, cfg: BucketsConfig, membersOf: MembersOf): Resolution {
    if (!(appid >= SHORTCUT_MIN)) return { bucket: 'none', via: 'not-a-shortcut' };

    const override = cfg.overrides[String(appid)];
    if (override) return { bucket: override, via: 'override' };

    let winner: BucketAssignment | undefined;
    const ids: string[] = [];
    const buckets: Bucket[] = [];
    for (const a of cfg.assignments) {
        if (!membersOf(a.id)?.has(appid)) continue;
        winner ??= a;
        ids.push(a.id);
        buckets.push(a.bucket);
    }
    if (!winner) return { bucket: 'none', via: 'default' };

    const res: Resolution = { bucket: winner.bucket, via: 'collection', collectionId: winner.id };
    if (new Set(buckets).size > 1) res.conflict = { collectionIds: ids, buckets };
    return res;
}

/** Appids (from `appids`) that sit in assigned collections of different buckets. */
export function findConflicts(
    cfg: BucketsConfig,
    membersOf: MembersOf,
    appids: Iterable<number>,
): { appid: number; resolution: Resolution }[] {
    const out: { appid: number; resolution: Resolution }[] = [];
    for (const appid of appids) {
        const resolution = resolveBucket(appid, cfg, membersOf);
        if (resolution.conflict && resolution.via === 'collection') out.push({ appid, resolution });
    }
    return out;
}
