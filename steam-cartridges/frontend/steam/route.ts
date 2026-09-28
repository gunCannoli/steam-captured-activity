/**
 * Steam assigns non-Steam shortcuts appids at the top of the 32-bit range.
 * Mirrors the backend's NON_STEAM_APPID_MIN.
 */
export const NON_STEAM_APPID_MIN = 0x8000_0000;

/** Normalizes and checks if an appid belongs to a non-Steam shortcut (handles signed int32 from CEF). */
export function isNonSteamAppId(appid: number): boolean {
    return (appid >>> 0) >= NON_STEAM_APPID_MIN;
}

/** `/library/app/4263274102` (and Big Picture's `/tab/<Name>` variants). */
export function appIdFromPath(pathname: string): number | undefined {
    const match = /^\/library\/app\/(\d+)/.exec(pathname);
    if (!match?.[1]) return undefined;

    const appid = Number(match[1]);
    return Number.isFinite(appid) ? appid : undefined;
}
