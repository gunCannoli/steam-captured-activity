// app/media: community media for a shortcut with no Steam match (features plan F2, ADR-0046). One EnsureFresh call
// for the `media` part (IGDB by the metadata's igdb_id, ScreenScraper keys); the settings toggles pick the items
// (domain/community-media); ScreenScraper images are fetched into the media bin as object URLs before the record
// update, so the community surface renders every card it is given. A shortcut with a Steam match keeps Steam's own
// community content (native-links, ADR-0038) and costs no call.
import type { ShortcutId } from "../kernel/appid";
import type { CommunityMedia, Identity, MediaItem, Part, RecordStore, Route } from "../kernel/record";
import type { MediaBin } from "../kernel/media-bin";
import type { backend as Backend } from "../ports/backend";
import { visibleMedia, type MediaToggles } from "../domain/community-media.ts";

export interface MediaDeps {
    backend: Pick<typeof Backend, "ensureFresh" | "getMediaImage">;
    records: RecordStore;
    /** ScreenScraper images as object URLs (kernel/media-bin); the community surface reads it. */
    bin: MediaBin;
    titleOf(appid: number): string | undefined;
    /** services.igdbEnabled and the routing service check for "igdb". */
    allowWeb(appid: ShortcutId): boolean;
    /** services.screenscraperEnabled and the routing service check for "screenscraper". */
    allowScreenscraper(appid: ShortcutId): boolean;
    /** Settings communityShowTrailers / communityShowArtworks. */
    toggles(): MediaToggles;
    /** ports/image objectUrl: base64 bytes -> a blob: URL, or null. */
    objectUrl(base64: string, ext: string): string | null;
    /** The items the card list will show, as soon as the lookup answered: lets a slow manual start before the images are in. */
    prefetch?(appid: ShortcutId, items: readonly MediaItem[]): void;
    /** Timing lines for the diagnostics log. */
    log?(message: string): void;
}

/** ScreenScraper images downloaded at the same time (ScreenScraper's own per-account thread limit is the ceiling). */
export const IMAGE_CONCURRENCY = 3;

export interface MediaResolver {
    ensure(appid: ShortcutId, route: Route, identity: Part<Identity> | undefined): Promise<Part<CommunityMedia>>;
}

export function createMedia(deps: MediaDeps): MediaResolver {
    /** The item if its image is (or now gets) in the bin; undefined when ScreenScraper could not deliver it. */
    async function withImage(appid: ShortcutId, item: MediaItem): Promise<MediaItem | undefined> {
        if (item.source !== "screenscraper" || item.kind === "manual") return item; // a manual is fetched when opened (app/manuals)
        const key = item.key!;
        const cached = deps.bin.get(appid, key);
        if (cached) return { ...item, width: cached.width ?? item.width, height: cached.height ?? item.height };
        let res;
        try {
            res = await deps.backend.getMediaImage(appid, key, deps.titleOf(appid));
        } catch {
            return undefined; // a failed download drops the card, never the part (ADR-0014)
        }
        if (!res.base64 || !res.ext) return undefined;
        const url = deps.objectUrl(res.base64, res.ext);
        if (!url) return undefined;
        deps.bin.put(appid, key, { url, width: res.width, height: res.height });
        return { ...item, width: res.width ?? item.width, height: res.height ?? item.height };
    }

    async function ensure(appid: ShortcutId, route: Route, identity: Part<Identity> | undefined): Promise<Part<CommunityMedia>> {
        if (identity?.data?.native) {
            const part: Part<CommunityMedia> = { status: "unsupported", message: "steam" };
            deps.records.update(appid, { media: part });
            return part;
        }
        const res = await deps.backend.ensureFresh(appid, ["media"], {
            title: deps.titleOf(appid) ?? "",
            route,
            identity,
            igdb_id: deps.records.get(appid)?.metadata?.data?.igdb_id,
            allowWeb: deps.allowWeb(appid),
            allowScreenscraper: deps.allowScreenscraper(appid),
        });
        const raw = res.error ? undefined : (res.parts.media as Part<CommunityMedia> | undefined);
        let part: Part<CommunityMedia> = raw ?? { status: "error", message: res.error ?? "no media part" };
        if (part.status === "ok" && part.data) {
            const visible = visibleMedia(part.data, deps.toggles());
            deps.prefetch?.(appid, visible);
            const started = Date.now();
            // A few at a time, kept in the record's order: each image is a separate download in the backend.
            const shown: Array<MediaItem | undefined> = new Array(visible.length);
            let next = 0;
            const worker = async () => {
                while (next < visible.length) {
                    const index = next++;
                    shown[index] = await withImage(appid, visible[index]!);
                }
            };
            await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, visible.length) }, worker));
            const items = shown.filter((item): item is MediaItem => !!item);
            deps.log?.(`Community media ${appid}: ${items.length}/${visible.length} cards, images in ${Date.now() - started} ms`);
            part = { ...part, data: { ...part.data, items } };
        }
        deps.records.update(appid, { media: part });
        return part;
    }

    return { ensure };
}
