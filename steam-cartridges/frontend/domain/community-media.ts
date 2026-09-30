// Domain: which community media a shortcut shows (features plan F2). Pure: the settings toggles and a cap per kind.
// Its imports carry `.ts`, so Node can run the unit tests with type stripping.
import type { CommunityMedia, MediaItem } from "../kernel/record";
import { asList } from "../kernel/lists.ts";

/** Settings communityShowTrailers and communityShowArtworks. */
export interface MediaToggles {
    trailers: boolean;
    artworks: boolean;
}

/** At most this many cards of each kind (Steam's section loads one page; more is a wall of art). */
export const MAX_PER_KIND = 12;

/** Is this item complete enough to become a card? */
export function isShowable(item: MediaItem | undefined): item is MediaItem {
    if (!item || typeof item !== "object") return false;
    if (item.kind === "video") return typeof item.youtube === "string" && item.youtube !== "";
    if (item.kind !== "screenshot" && item.kind !== "artwork") return false;
    if (item.source === "screenscraper") return typeof item.key === "string" && item.key !== "";
    return typeof item.url === "string" && item.url !== "";
}

/** The items to show, in the backend's order: allowed by the toggles, complete, at most MAX_PER_KIND per kind. */
export function visibleMedia(media: CommunityMedia | undefined, toggles: MediaToggles): MediaItem[] {
    const counts: Record<string, number> = {};
    const out: MediaItem[] = [];
    for (const item of asList<MediaItem>(media?.items)) {
        if (!isShowable(item)) continue;
        if (item.kind === "video" ? !toggles.trailers : !toggles.artworks) continue;
        counts[item.kind] = (counts[item.kind] ?? 0) + 1;
        if (counts[item.kind]! > MAX_PER_KIND) continue;
        out.push(item);
    }
    return out;
}
