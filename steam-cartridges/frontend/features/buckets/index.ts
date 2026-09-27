import { onSettingChange, setting } from '../../settings/settings';
import { collectionsReady, listCollections, membersOf, type CollectionInfo } from './collections';
import { pendingOr } from './ready';
import { findConflicts, resolveBucket, SHORTCUT_MIN, type Bucket, type Resolution } from './resolve';
import { getAutoRoutingProfile } from './auto-routing';

export { waitForCollections, listCollections, membersOf, invalidateMembership, collectionsReady } from './collections';
export { loadAutoRoutingProfiles, getAutoRoutingProfile, getAllAutoRoutingProfiles } from './auto-routing';
export type { Bucket, BucketsConfig, CollectionRule, Resolution } from './resolve';

let metadataAppids: () => Iterable<number> = () => [];
/** game-info registers its cache here (avoids an import cycle). */
export function setMetadataAppidSource(fn: () => Iterable<number>): void {
    metadataAppids = fn;
}

/** The shortcut's display title (O(1) appStore lookup), for rule patterns. */
function titleOf(appid: number): string | undefined {
    try {
        const name = (window as any).appStore?.GetAppOverviewByAppID?.(appid)?.display_name;
        return typeof name === 'string' ? name : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Resolutions are sticky for the session (ADR-0036) and dropped only when the
 * bucket settings change. Our own Game Info enrichment adds store categories,
 * which feed Steam's dynamic collections; without this a game could leave a
 * rule's collection because we enriched it, and flip bucket on the next view.
 * `pending` is never memoised.
 */
const memo = new Map<number, Resolution>();

/** Current settings + live collections, memoised per session. */
export function getBucket(appid: number): Resolution {
    const hit = memo.get(appid);
    if (hit) return hit;
    const cfg = setting('buckets');
    const autoMode = setting('autoRoutingMode');
    const autoProf = autoMode ? getAutoRoutingProfile(appid) : undefined;
    const r =
        appid >= SHORTCUT_MIN && cfg.overrides[String(appid)]
            ? resolveBucket(appid, cfg, membersOf, titleOf, autoProf)
            : (pendingOr<Resolution>(cfg.rules.length > 0, collectionsReady(), () =>
                  resolveBucket(appid, cfg, membersOf, titleOf, autoProf),
              ) as Resolution);
    if (r.via !== 'pending') memo.set(appid, r);
    return r;
}

export function onBucketsChanged(fn: () => void): () => void {
    return onSettingChange((key) => {
        if (key !== 'buckets' && key !== 'autoRoutingMode') return;
        memo.clear();
        fn();
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
    const assigned = new Map(cfg.rules.map((a) => [a.id, a.bucket] as const));
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
        collections: live.map((c) => ({ ...c, bucket: assigned.get(c.id) ?? cfg.default })),
        conflicts: findConflicts(cfg, membersOf, appids, titleOf).map(({ appid, resolution }) => ({
            appid,
            name: shortcutName(appid),
            collectionIds: resolution.conflict!.collectionIds,
            buckets: resolution.conflict!.buckets,
            using: resolution.bucket,
        })),
        missing: cfg.rules
            .filter((a) => !liveIds.has(a.id))
            .map((a) => ({ id: a.id, name: a.name, bucket: a.bucket, relinkId: live.find((c) => c.name === a.name)?.id })),
        unbucketedWithMetadata: [...metadataAppids()].filter((id) => getBucket(id).bucket === 'none').length,
        games,
    };
}
