import { logger } from "../logger";

/** The shortcut's display title, from appStore or Steam's shortcut data. */
export function resolveShortcutTitle(appid: number): string | undefined {
    try {
        const overview = (window as any).appStore?.GetAppOverviewByAppID?.(
            appid,
        );
        if (overview?.display_name) return overview.display_name;

        const shortcut = (window as any).SteamClient?.Apps?.GetShortcutData?.(
            appid,
        );
        if (shortcut?.strAppName) return shortcut.strAppName;
    } catch (err) {
        logger.warn(`Could not read shortcut title for ${appid}:`, err);
    }
    return undefined;
}
