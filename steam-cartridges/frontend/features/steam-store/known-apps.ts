import { NATIVE_APPID_MAX, buildKnownIndex, matchKnownIndex, type KnownApp, type KnownIndex } from './resolve';

/** Steam's app_type for a game (P0 T3: 309 of 470 native entries here). */
const APP_TYPE_GAME = 1;

let index: KnownIndex | null = null;

/** Native games Steam already knows (owned/known; not the whole store). Zero network. */
function readNativeGames(): KnownApp[] {
    const all: any[] = (window as any).appStore?.allApps ?? [];
    return all
        .filter((a) => a && a.appid > 0 && a.appid < NATIVE_APPID_MAX && a.app_type === APP_TYPE_GAME && a.display_name)
        .map((a) => ({ appid: a.appid as number, name: String(a.display_name) }));
}

/** Rebuild the index (called when the settings panel opens). */
export function refreshKnownApps(): void {
    index = buildKnownIndex(readNativeGames());
}

/** Lazily built normalised index. */
export function matchKnownNative(title: string): number | undefined {
    if (!index) refreshKnownApps();
    return matchKnownIndex(title, index!);
}

export function knownAppName(appid: number): string | undefined {
    return readNativeGames().find((a) => a.appid === appid)?.name;
}
