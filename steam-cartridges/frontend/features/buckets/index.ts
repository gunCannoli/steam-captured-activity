import { onSettingChange, setting } from '../../settings/settings';
import { collectionsReady, listCollections, membersOf, type CollectionInfo } from './collections';
import { pendingOr } from './ready';
import { findConflicts, resolveBucket, SHORTCUT_MIN, type Bucket, type Resolution } from './resolve';

export { waitForCollections, listCollections, invalidateMembership, collectionsReady } from './collections';
export type { Bucket, BucketsConfig, Resolution } from './resolve';

let metadataAppids: () => Iterable<number> = () => [];
/** game-info registers its cache here (avoids an import cycle). */
export function setMetadataAppidSource(fn: () => Iterable<number>): void {
    metadataAppids = fn;
}

/** Current settings + live collections. */
export function getBucket(appid: number): Resolution {
    const cfg = setting('buckets');
    if (appid >= SHORTCUT_MIN && cfg.overrides[String(appid)]) return resolveBucket(appid, cfg, membersOf);
    return pendingOr<Resolution>(cfg.assignments.length > 0, collectionsReady(), () => resolveBucket(appid, cfg, membersOf)) as Resolution;
}

export function onBucketsChanged(fn: () => void): () => void {
    return onSettingChange((key) => {
        if (key === 'buckets') fn();
    });
}

export function shortcutName(appid: number): string {
    try {
        return (window as any).appStore?.GetAppOverviewByAppID?.(appid)?.display_name ?? String(appid);
    } catch {
        return String(appid);
    }
}

/** Every shortcut in the library, from appStore. */
export function listShortcuts(): { appid: number; name: string }[] {
    const all: any[] = (window as any).appStore?.allApps ?? [];
    return all
        .filter((a) => a?.appid >= SHORTCUT_MIN)
        .map((a) => ({ appid: a.appid as number, name: String(a.display_name ?? a.appid) }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

export interface BucketReport {
    collections: (CollectionInfo & { bucket: Bucket })[];
    conflicts: { appid: number; name: string; collectionIds: string[]; buckets: Bucket[]; using: Bucket }[];
    missing: { id: string; name: string; bucket: Bucket; relinkId?: string }[];
    unbucketedWithMetadata: number;
    ready: boolean;
    games: Record<number, { bucket: Bucket; via: Resolution['via'] }>;
}

export function bucketReport(): BucketReport {
    const cfg = setting('buckets');
    const ready = collectionsReady();
    const live = listCollections();
    const liveIds = new Set(live.map((c) => c.id));
    const assigned = new Map(cfg.assignments.map((a) => [a.id, a.bucket] as const));
    const shortcuts = listShortcuts();
    const appids = shortcuts.map((s) => s.appid);

    const games: BucketReport['games'] = {};
    for (const appid of appids) {
        const r = getBucket(appid);
        games[appid] = { bucket: r.bucket, via: r.via };
    }

    if (!ready) {
        return { ready, collections: [], conflicts: [], missing: [], unbucketedWithMetadata: 0, games };
    }
    return {
        ready,
        collections: live.map((c) => ({ ...c, bucket: assigned.get(c.id) ?? 'none' })),
        conflicts: findConflicts(cfg, membersOf, appids).map(({ appid, resolution }) => ({
            appid,
            name: shortcutName(appid),
            collectionIds: resolution.conflict!.collectionIds,
            buckets: resolution.conflict!.buckets,
            using: resolution.bucket,
        })),
        missing: cfg.assignments
            .filter((a) => !liveIds.has(a.id))
            .map((a) => ({ id: a.id, name: a.name, bucket: a.bucket, relinkId: live.find((c) => c.name === a.name)?.id })),
        unbucketedWithMetadata: [...metadataAppids()].filter((id) => getBucket(id).bucket === 'none').length,
        games,
    };
}
