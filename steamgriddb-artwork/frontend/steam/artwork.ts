import { logger } from '../logger';
import type { ArtworkBundle, ArtworkUrls } from '../rpc';

/**
 * Steam custom artwork slot types:
 * 0: Portrait Capsule (600x900)
 * 1: Hero Banner (1920x620)
 * 2: Transparent Logo PNG
 * 3: Wide Capsule (920x430)
 */
export const ARTWORK_TYPES = {
    PORTRAIT: 0,
    HERO: 1,
    LOGO: 2,
    WIDE: 3,
} as const;

/**
 * Fetch an image URL and return as base64 and extension.
 * If direct fetch fails (e.g. CORS restriction on cdn2.steamgriddb.com),
 * fall back to wsrv.nl proxy.
 */
export async function fetchImageAsBase64(
    url: string,
    forcePng = false,
): Promise<{ base64: string; ext: string } | null> {
    const attempt = async (targetUrl: string): Promise<Blob | null> => {
        try {
            const resp = await fetch(targetUrl);
            if (!resp.ok) return null;
            const blob = await resp.blob();
            if (!blob || blob.size < 100) return null;
            return blob;
        } catch {
            return null;
        }
    };

    let blob = await attempt(url);
    if (!blob && url.includes("steamgriddb.com")) {
        const proxied =
            "https://wsrv.nl/?url=" +
            url.replace(/^https?:\/\//, "") +
            (forcePng ? "&output=png" : "");
        blob = await attempt(proxied);
    }

    if (!blob) return null;

    const base64 = await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            if (!result) {
                resolve(null);
                return;
            }
            const comma = result.indexOf(",");
            resolve(comma >= 0 ? result.substring(comma + 1) : result);
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
    });

    if (!base64) return null;

    let ext = "png";
    if (!forcePng) {
        if (
            blob.type === "image/jpeg" ||
            url.toLowerCase().includes(".jpg") ||
            url.toLowerCase().includes(".jpeg")
        ) {
            ext = "jpg";
        }
    }

    return { base64, ext };
}

export async function applyCustomArtworkFromUrls(
    appid: number,
    urls: ArtworkUrls,
): Promise<number> {
    const sc = (window as any).SteamClient;
    if (!sc?.Apps?.SetCustomArtworkForApp) {
        logger.warn(
            "SteamClient.Apps.SetCustomArtworkForApp is not available.",
        );
        return 0;
    }

    const tasks: [string | undefined, number, string, boolean][] = [
        [urls.portrait, ARTWORK_TYPES.PORTRAIT, "portrait", false],
        [urls.hero, ARTWORK_TYPES.HERO, "hero", false],
        [urls.logo, ARTWORK_TYPES.LOGO, "logo", true],
        [urls.wide, ARTWORK_TYPES.WIDE, "wide", false],
    ];

    // Download all available image slots in parallel using Chromium's network engine
    const downloaded = await Promise.all(
        tasks.map(async ([url, slot, label, forcePng]) => {
            if (!url) return null;
            try {
                const asset = await fetchImageAsBase64(url, forcePng);
                return asset ? { asset, slot, label } : null;
            } catch (err) {
                logger.warn(`Failed to fetch ${label} image from ${url}:`, err);
                return null;
            }
        }),
    );

    let appliedCount = 0;
    for (const item of downloaded) {
        if (!item) continue;
        const { asset, slot, label } = item;
        try {
            if (typeof sc.Apps.ClearCustomArtworkForApp === "function") {
                try {
                    await sc.Apps.ClearCustomArtworkForApp(appid, slot);
                } catch {}
                await new Promise((r) => setTimeout(r, 100));
            }
            await sc.Apps.SetCustomArtworkForApp(
                appid,
                asset.base64,
                asset.ext,
                slot,
            );
            appliedCount++;
            logger.info(`Set custom ${label} artwork for appid ${appid}`);
        } catch (err) {
            logger.warn(
                `Failed to set ${label} artwork for appid ${appid}:`,
                err,
            );
        }
    }

    return appliedCount;
}

export async function applyCustomArtwork(
    appid: number,
    bundle: ArtworkBundle,
): Promise<number> {
    const sc = (window as any).SteamClient;
    if (!sc?.Apps?.SetCustomArtworkForApp) {
        logger.warn(
            "SteamClient.Apps.SetCustomArtworkForApp is not available.",
        );
        return 0;
    }

    const items: [typeof bundle.portrait, number, string][] = [
        [bundle.portrait, ARTWORK_TYPES.PORTRAIT, "portrait"],
        [bundle.hero, ARTWORK_TYPES.HERO, "hero"],
        [bundle.logo, ARTWORK_TYPES.LOGO, "logo"],
        [bundle.wide, ARTWORK_TYPES.WIDE, "wide"],
    ];

    let appliedCount = 0;
    for (const [asset, slot, label] of items) {
        if (!asset?.base64) continue;
        try {
            if (typeof sc.Apps.ClearCustomArtworkForApp === "function") {
                try {
                    await sc.Apps.ClearCustomArtworkForApp(appid, slot);
                } catch {}
                await new Promise((r) => setTimeout(r, 100));
            }
            await sc.Apps.SetCustomArtworkForApp(
                appid,
                asset.base64,
                asset.ext || "png",
                slot,
            );
            appliedCount++;
            logger.info(`Set custom ${label} artwork for appid ${appid}`);
        } catch (err) {
            logger.warn(
                `Failed to set ${label} artwork for appid ${appid}:`,
                err,
            );
        }
    }

    return appliedCount;
}
