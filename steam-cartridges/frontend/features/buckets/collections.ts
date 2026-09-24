import { logger } from '../../logger';
import { SHORTCUT_MIN } from './resolve';

/**
 * The only file that touches `collectionStore` (steam-components.md
 * "Collections"). Failure to resolve means empty results, so everything falls
 * back to bucket `none`.
 */

export interface CollectionInfo {
    id: string;
    name: string;
    dynamic: boolean;
    shortcutCount: number;
}

const TTL_MS = 2000;
let warned = false;
const cache = new Map<string, { at: number; set: ReadonlySet<number> }>();

function store(): any {
    const s = (window as any).collectionStore;
    if (!s || !Array.isArray(s.userCollections)) {
        if (!warned) {
            warned = true;
            logger.warn('collectionStore unavailable; all games resolve to bucket "none".');
        }
        return undefined;
    }
    return s;
}

function shortcutIds(coll: any): Set<number> {
    const out = new Set<number>();
    const apps = coll?.apps;
    const keys: Iterable<unknown> = apps instanceof Map ? apps.keys() : Array.isArray(apps) ? apps.map((a: any) => a?.appid ?? a) : [];
    for (const k of keys) {
        const n = Number(k);
        if (Number.isFinite(n) && n >= SHORTCUT_MIN) out.add(n);
    }
    return out;
}

export async function waitForCollections(timeoutMs = 10_000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if ((window as any).collectionStore?.userCollections?.length > 0) return true;
        await new Promise((r) => setTimeout(r, 250));
    }
    return false;
}

export function listCollections(): CollectionInfo[] {
    const s = store();
    if (!s) return [];
    return s.userCollections.map((c: any) => ({
        id: String(c.id),
        name: String(c.displayName ?? c.id),
        dynamic: !!c.bIsDynamic,
        shortcutCount: shortcutIds(c).size,
    }));
}

/** Shortcut members of a collection; undefined when the collection no longer exists. */
export function membersOf(id: string): ReadonlySet<number> | undefined {
    const s = store();
    if (!s) return undefined;
    const now = Date.now();
    const hit = cache.get(id);
    if (hit && now - hit.at < TTL_MS) return hit.set;
    const coll = s.userCollections.find((c: any) => c?.id === id);
    if (!coll) {
        cache.delete(id);
        return undefined;
    }
    const set = shortcutIds(coll);
    cache.set(id, { at: now, set });
    return set;
}

/** Drop cached membership (after the user changes bucket settings). */
export function invalidateMembership(): void {
    cache.clear();
}
