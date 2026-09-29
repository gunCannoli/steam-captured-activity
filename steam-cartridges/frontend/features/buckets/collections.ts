import { logger } from '../../logger';
import { SHORTCUT_MIN } from './resolve';

/**
 * Membership for bucket rules, read through the collections sensor
 * (sensors/collections, wired in index.tsx; migration plan M2). Failure to
 * resolve means empty results, so everything falls back to bucket `none`.
 */

/** Structural match of sensors/collections `collectionsSource` (no import: ADR-0039 layers). */
export interface CollectionsSource {
    ready(): boolean;
    list(): any[] | undefined;
}

let source: CollectionsSource = { ready: () => false, list: () => undefined };

/** Called once by index.tsx, before anything resolves a bucket. */
export function setCollectionsSource(next: CollectionsSource): void {
    source = next;
}

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
    return source.ready();
}

function userCollections(): any[] | undefined {
    if (!source.ready()) {
        if (!warned) {
            warned = true;
            logger.info('collectionStore not ready yet; games resolve as pending.');
        }
        return undefined;
    }
    const list = source.list();
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
        if (collectionsReady()) return source.list() !== undefined;
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
