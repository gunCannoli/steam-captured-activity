/**
 * Pure part of the community surface (features plan F2, ADR-0046): our media items as the items Steam's Community
 * Content loader returns from `library/appcommunityfeed/<appid>` (module 77163, class `ae`). Shape copied from a live
 * feed (435150, 2026-09-30): the card code reads every field below. Its one runtime import carries `.ts` for the tests.
 *
 * Card types Steam renders (EWorkshopFileType, module 44846): 3 Artwork and 5 Screenshot (an image; a click opens
 * Steam's fullscreen viewer on full_image_url), 4 Video (Steam's own YouTube player on youtube_video_id). Guides (9, 10)
 * open a Community page by file id, so no item becomes one.
 */
import type { MediaItem } from "../../kernel/record";
import type { MediaImage } from "../../kernel/media-bin";
import { toShortcutId } from "../../kernel/appid.ts";

export const FILE_TYPE = { artwork: 3, video: 4, screenshot: 5 } as const;

/**
 * Our cards' published file ids: 15 digits from 9e14 (Valve's ids are ~3.8e9 today), unique per (shortcut, index),
 * and a safe integer. Steam keys cards, dedupes pages and asks PublishedFile.GetDetails by this id.
 */
export const FEED_ID_BASE = 900_000_000_000_000;
export const MAX_ITEMS = 10_000;

export function feedId(appid: number, index: number): string {
    return String(FEED_ID_BASE + appid * MAX_ITEMS + index);
}

export const CREATOR_NAMES: Record<MediaItem["source"], string> = { igdb: "IGDB", screenscraper: "ScreenScraper" };

/** One item of Steam's community feed, as its card components read it. */
export interface FeedItem {
    published_file_id: string;
    type: number;
    title: string;
    description: string;
    preview_image_url: string;
    full_image_url: string;
    image_width: number;
    image_height: number;
    youtube_video_id: string | null;
    /** null hides the count (Steam renders a count only when it is not null). */
    comment_count: null;
    votes_for: null;
    /** Must be an array: the card filters the user's content preferences with indexOf on it. */
    content_descriptorids: number[];
    spoiler_tag: boolean;
    rating_stars: number;
    maybe_inappropriate_sex: number;
    maybe_inappropriate_violence: number;
    creator: { name: string; steamid: string; avatar: string; online_state: number };
    reactions: never[];
}

const youtubeThumb = (id: string) => `https://img.youtube.com/vi/${id}/hqdefault.jpg`;

/**
 * The feed for one shortcut, in the record's order. A ScreenScraper item shows only when `imageOf(key)` has its
 * object URL (app/media fetched it); an item that cannot be shown is left out.
 */
export function toFeedItems(appid: number, items: readonly MediaItem[], imageOf: (key: string) => MediaImage | undefined): FeedItem[] {
    const out: FeedItem[] = [];
    items.forEach((item, index) => {
        if (index >= MAX_ITEMS) return;
        let type: number;
        let preview: string;
        let full: string;
        let width = 0;
        let height = 0;
        let youtube: string | null = null;
        if (item.kind === "video") {
            if (!item.youtube) return;
            type = FILE_TYPE.video;
            youtube = item.youtube;
            preview = full = youtubeThumb(item.youtube);
        } else if (item.kind === "screenshot" || item.kind === "artwork") {
            type = FILE_TYPE[item.kind];
            if (item.source === "screenscraper") {
                const image = item.key ? imageOf(item.key) : undefined;
                if (!image) return;
                preview = full = image.url;
                width = image.width ?? item.width ?? 0;
                height = image.height ?? item.height ?? 0;
            } else {
                if (!item.url) return;
                full = item.url;
                preview = item.thumb ?? item.url;
                width = item.width ?? 0;
                height = item.height ?? 0;
            }
            // Steam lays an image out by its size and drops one without it (no row template matches size 0).
            if (!(width > 0 && height > 0)) return;
        } else {
            return;
        }
        out.push({
            published_file_id: feedId(appid, index),
            type,
            title: item.title ?? "",
            description: "",
            preview_image_url: preview,
            full_image_url: full,
            image_width: width,
            image_height: height,
            youtube_video_id: youtube,
            comment_count: null,
            votes_for: null,
            content_descriptorids: [],
            spoiler_tag: false,
            rating_stars: 0,
            maybe_inappropriate_sex: 0,
            maybe_inappropriate_violence: 0,
            creator: { name: CREATOR_NAMES[item.source] ?? "", steamid: "0", avatar: "", online_state: 0 },
            reactions: [],
        });
    });
    return out;
}

/** A fresh copy for each load: Steam's cards write into what they are given (votes), and desktop and Big Picture load separately. */
export function copyFeed(feed: readonly FeedItem[]): FeedItem[] {
    return feed.map((item) => ({ ...item, content_descriptorids: [], reactions: [], creator: { ...item.creator } }));
}

/**
 * What the patched `LoadCommunityContentAndVotes(appid, page)` returns for one of our shortcuts, or undefined to let
 * Steam's own loader run (a native app, a mapped shortcut whose appid native-links already swapped, or no feed).
 * Page 1 is the whole feed; later pages are empty, so Steam shows its own "no more content" line.
 */
export function loaderAnswer(
    rawAppid: unknown,
    page: unknown,
    feedOf: (appid: number) => readonly FeedItem[] | undefined,
): { vecContent: FeedItem[]; mapVotes: Map<string, unknown> } | undefined {
    const appid = toShortcutId(rawAppid);
    if (appid === undefined) return undefined;
    const feed = feedOf(appid);
    if (!feed || feed.length === 0) return undefined;
    return { vecContent: Number(page) <= 1 ? copyFeed(feed) : [], mapVotes: new Map() };
}

/** Is this jsx element Steam's Community Content section class (the one that owns the loader)? O(1). */
export function isContentSection(type: unknown, props: unknown): boolean {
    if (typeof type !== "function") return false;
    const p = props as { appid?: unknown; labelId?: unknown } | null | undefined;
    if (!p || typeof p.appid !== "number" || !("labelId" in p)) return false;
    const proto = (type as { prototype?: object }).prototype;
    return !!proto && "BindInnerContainer" in proto && "AutoLoadAdditionalContent" in proto && "CheckAndLoadInitialContent" in proto;
}
