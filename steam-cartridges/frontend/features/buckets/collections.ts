import { logger } from '../../logger';
import { SHORTCUT_MIN } from './resolve';
import { isCollectionStoreReady, readUserCollections } from './ready';

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

export function collectionsReady(): boolean {
    return isCollectionStoreReady((window as any).collectionStore);
}

function userCollections(): any[] | undefined {
    const s = (window as any).collectionStore;
    if (!isCollectionStoreReady(s)) {
        if (!warned) {
            warned = true;
            logger.info('collectionStore not ready yet; games resolve as pending.');
        }
        return undefined;
    }
    const list = readUserCollections(s);
    if (!list) logger.warn('collectionStore.userCollections unavailable; treating as empty.');
    return list;
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

export async function waitForCollections(timeoutMs = 30_000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (collectionsReady()) return readUserCollections((window as any).collectionStore) !== undefined;
        await new Promise((r) => setTimeout(r, 250));
    }
    return false;
}

export function listCollections(): CollectionInfo[] {
    const list = userCollections();
    if (!list) return [];
    return list.map((c: any) => ({
        id: String(c.id),
        name: String(c.displayName ?? c.id),
        dynamic: !!c.bIsDynamic,
        shortcutCount: shortcutIds(c).size,
    }));
}

/** Shortcut members of a collection; undefined when unavailable (not cached while not ready). */
export function membersOf(id: string): ReadonlySet<number> | undefined {
    const list = userCollections();
    if (!list) return undefined;
    const now = Date.now();
    const hit = cache.get(id);
    if (hit && now - hit.at < TTL_MS) return hit.set;
    const coll = list.find((c: any) => c?.id === id);
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
