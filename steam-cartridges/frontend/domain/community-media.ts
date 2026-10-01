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

/**
 * A ScreenScraper image smaller than this is not shown: its console screenshots and title screens are tiny (a title screen
 * here is 5 KB at 256x224, a screenshot 62 KB at 640x480) and look poor beside IGDB's 1080p images, while its fanart is far
 * larger (429 KB at 1280x720). About 150 KB keeps real artwork and drops the low-resolution captures.
 */
export const MIN_SCREENSCRAPER_BYTES = 150 * 1024;

/** The size of a base64 payload in bytes, without decoding it. */
export function base64Bytes(base64: string): number {
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    return Math.floor((base64.length * 3) / 4) - padding;
}

/** Is a downloaded ScreenScraper image big enough to show? */
export function isLargeEnough(bytes: number): boolean {
    return bytes >= MIN_SCREENSCRAPER_BYTES;
}

/** Is this item complete enough to become a card? */
export function isShowable(item: MediaItem | undefined): item is MediaItem {
    if (!item || typeof item !== "object") return false;
    if (item.kind === "video") return typeof item.youtube === "string" && item.youtube !== "";
    if (item.kind !== "screenshot" && item.kind !== "artwork") return false;
    if (item.source === "screenscraper") return typeof item.key === "string" && item.key !== "";
    return typeof item.url === "string" && item.url !== "";
}

/**
 * The items to show: allowed by the toggles, complete, at most MAX_PER_KIND per kind. Order: trailers, then the images
 * ScreenScraper has for this exact game (chosen by ROM and console, so the most specific), then IGDB's. The ScreenScraper
 * images go first so IGDB's larger sets can neither crowd them out of the cap nor leave them at the end of the grid, where
 * Steam's row layout drops a card that fits no row.
 */
export function visibleMedia(media: CommunityMedia | undefined, toggles: MediaToggles): MediaItem[] {
    const counts: Record<string, number> = {};
    const rank = (item: MediaItem) => (item.kind === "video" ? 0 : item.source === "screenscraper" ? 1 : 2);
    const wanted = asList<MediaItem>(media?.items)
        .filter(isShowable)
        .filter((item) => (item.kind === "video" ? toggles.trailers : toggles.artworks))
        .map((item, index) => ({ item, index }))
        .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
        .map((entry) => entry.item);
    const out: MediaItem[] = [];
    for (const item of wanted) {
        counts[item.kind] = (counts[item.kind] ?? 0) + 1;
        if (counts[item.kind]! > MAX_PER_KIND) continue;
        out.push(item);
    }
    return out;
}
