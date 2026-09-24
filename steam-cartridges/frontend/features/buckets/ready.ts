/** Plain-field read, no MobX side effects. Steam creates m_mapCollectionsFromStorage on its first
 *  cloud-storage callback; before that, reading userCollections / uncategorizedCollection throws
 *  inside a keepAlive computed and poisons it for the session (see plan). */
export function isCollectionStoreReady(store: any): boolean {
    const m = store?.m_mapCollectionsFromStorage;
    return !!m && typeof m.values === 'function';
}
/** userCollections only when ready; never throws. */
export function readUserCollections(store: any): any[] | undefined {
    if (!isCollectionStoreReady(store)) return undefined;
    try {
        const list = store.userCollections;
        return Array.isArray(list) ? list : undefined;
    } catch {
        return undefined;
    }
}
/** Collection-dependent resolution is deferred (`pending`) until the store is ready. */
export function pendingOr<T>(needsCollections: boolean, ready: boolean, resolve: () => T): T | { bucket: 'none'; via: 'pending' } {
    if (needsCollections && !ready) return { bucket: 'none', via: 'pending' };
    return resolve();
}
