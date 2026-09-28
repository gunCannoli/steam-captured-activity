/**
 * Community Store & Media Integration for Non-Steam Games.
 *
 * Integrates trailers, ScreenScraper artworks/screenshots, and community links
 * into Steam's in-memory stores (CWorkshopStore, CGameRecordingStore).
 */

import { logger } from "../logger";
import { buildWorkshopMediaItems } from "./community-core";
import {
    rpc,
    type GameTrailerItem,
    type GameCommunityLinkItem,
    type GameArtworkCommunityItem,
} from "../rpc";

export interface CommunityData {
    appid: number;
    trailers: GameTrailerItem[];
    screenshots: string[];
    artworks: GameArtworkCommunityItem[];
    links: GameCommunityLinkItem[];
    manualUrl?: string;
    titlescreen?: string;
    fanart?: string;
    video?: string;
}

const communityCache = new Map<number, CommunityData>();
const listeners = new Set<(appid: number, data: CommunityData) => void>();

export function onCommunityDataChanged(fn: (appid: number, data: CommunityData) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function notifyChanged(appid: number, data: CommunityData) {
    for (const fn of listeners) {
        try {
            fn(appid, data);
        } catch (e) {
            logger.warn("Community listener threw:", e);
        }
    }
}

/**
 * Gets cached community data for a shortcut appid.
 */
export function getCommunityData(appid: number): CommunityData | undefined {
    return (
        communityCache.get(appid) ??
        communityCache.get(appid >>> 0) ??
        communityCache.get(appid | 0)
    );
}

/**
 * Loads media, trailers, and community links for a non-Steam game.
 */
export async function loadCommunityData(appid: number, title?: string): Promise<CommunityData | undefined> {
    const existing = getCommunityData(appid);
    if (existing) return existing;

    try {
        const [trailersRes, linksRes, mediaRes, manualRes] = await Promise.all([
            rpc.getGameTrailers(appid, title).catch(() => ({ success: false, trailers: [] })),
            rpc.getGameCommunityLinks(appid, title).catch(() => ({ success: false, links: [], artworks: [] })),
            rpc.getGameMedia(appid).catch(() => ({ success: false, media: undefined })),
            rpc.getGameManual(appid).catch(() => ({ success: false, manual_url: undefined })),
        ]);

        const media = mediaRes?.media;
        const trailers = trailersRes?.trailers ?? [];
        const links = linksRes?.links ?? [];
        const artworks = linksRes?.artworks ?? [];
        const manualUrl = manualRes?.manual_url || media?.manual;

        const data: CommunityData = {
            appid,
            trailers,
            screenshots: media?.screenshots ?? [],
            artworks,
            links,
            manualUrl,
            titlescreen: media?.titlescreen,
            fanart: media?.fanart,
            video: media?.video,
        };

        communityCache.set(appid, data);
        communityCache.set(appid >>> 0, data);
        communityCache.set(appid | 0, data);

        // Populate Steam's WorkshopStore with community screenshots & fanart
        registerWorkshopMedia(appid, data);

        notifyChanged(appid, data);
        return data;
    } catch (err) {
        logger.warn(`Failed loading community data for ${appid}:`, err);
        return undefined;
    }
}

/**
 * Registers media items into Steam's in-memory CWorkshopStore so Steam's native
 * image viewers and lightboxes recognize them without errors.
 */
export function registerWorkshopMedia(appid: number, data: CommunityData): void {
    try {
        const workshopStore = (window as any).workshopStore;
        if (!workshopStore) return;

        const mapFiles = workshopStore.m_mapPublishedFiles;
        if (!mapFiles) return;

        const items = buildWorkshopMediaItems(
            appid,
            data.screenshots,
            data.artworks,
            data.titlescreen,
            data.fanart,
        );

        for (const item of items) {
            if (!mapFiles.has(item.id)) {
                mapFiles.set(item.id, {
                    m_nPublishedFileId: item.id,
                    m_unAppID: item.appid,
                    m_strTitle: item.title,
                    m_strPreviewURL: item.url,
                    m_strStandardURL: item.url,
                    m_nTimeCreated: Math.floor(Date.now() / 1000),
                    m_bIsMod: false,
                });
            }
        }
    } catch (e) {
        logger.warn("Could not register community items in workshopStore:", e);
    }
}
