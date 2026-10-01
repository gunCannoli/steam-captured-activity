// app/media: community media for a shortcut with no Steam match (features plan F2, ADR-0046). One EnsureFresh call
// for the `media` part (IGDB by the metadata's igdb_id, ScreenScraper keys); the settings toggles pick the items
// (domain/community-media); ScreenScraper images are fetched into the media bin as object URLs before the record
// update, so the community surface renders every card it is given. A shortcut with a Steam match keeps Steam's own
// community content (native-links, ADR-0038) and costs no call.
import type { ShortcutId } from "../kernel/appid";
import type { CommunityMedia, Identity, MediaItem, Part, RecordStore, Route } from "../kernel/record";
import type { MediaBin } from "../kernel/media-bin";
import type { backend as Backend } from "../ports/backend";
import { base64Bytes, isLargeEnough, visibleMedia, type MediaToggles } from "../domain/community-media.ts";

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
}

export interface MediaResolver {
    ensure(appid: ShortcutId, route: Route, identity: Part<Identity> | undefined): Promise<Part<CommunityMedia>>;
}

export function createMedia(deps: MediaDeps): MediaResolver {
    /** Images this session found too small to show (domain/community-media.isLargeEnough): not downloaded again. */
    const tooSmall = new Set<string>();

    /** The item if its image is (or now gets) in the bin; undefined when ScreenScraper could not deliver it. */
    async function withImage(appid: ShortcutId, item: MediaItem): Promise<MediaItem | undefined> {
        if (item.source !== "screenscraper") return item;
        const key = item.key!;
        if (tooSmall.has(`${appid}:${key}`)) return undefined;
        const cached = deps.bin.get(appid, key);
        if (cached) return { ...item, width: cached.width ?? item.width, height: cached.height ?? item.height };
        let res;
        try {
            res = await deps.backend.getMediaImage(appid, key, deps.titleOf(appid));
        } catch {
            return undefined; // a failed download drops the card, never the part (ADR-0014)
        }
        if (!res.base64 || !res.ext) return undefined;
        if (!isLargeEnough(base64Bytes(res.base64))) {
            tooSmall.add(`${appid}:${key}`); // a low-resolution capture: IGDB's images look better beside it
            return undefined;
        }
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
            const items: MediaItem[] = [];
            // One at a time: each ScreenScraper image is a blocking download in the backend.
            for (const item of visibleMedia(part.data, deps.toggles())) {
                const shown = await withImage(appid, item);
                if (shown) items.push(shown);
            }
            part = { ...part, data: { ...part.data, items } };
        }
        deps.records.update(appid, { media: part });
        return part;
    }

    return { ensure };
}
