// Surface `artwork`: what the composition root gives it (migration plan M3.9, § 7.0 D3/D6).
import type { SurfaceDeps } from "../../kernel/surface";

/** What the surface wrote, for the backend to remember (steam_store.json applied_artwork). */
export interface RecordArtworkInfo {
    source: "steam-cdn" | "steamgriddb";
    steamAppid?: number;
    slots: number[];
    failed: number[];
    tried: number[];
}

/** The library icon the surface set, for the backend to remember (steam_store.json applied_icon). */
export interface RecordIconInfo {
    path: string;
    /** The shortcuts.vdf icon value ours replaced ("" = the exe), put back on Clear. */
    previous: string;
    source: "steam-cdn" | "steamgriddb";
    steamAppid?: number;
}

export const deps: SurfaceDeps & {
    /** The backend image fetch for Steam CDN URLs (rpc.steamStoreDownloadImage). */
    downloadImage(url: string): Promise<{ base64?: string; ext?: string } | null | undefined>;
    /** Remember the slots written; `{ error }` = the mapping vanished meanwhile (undo the write). */
    recordArtwork(appid: number, info: RecordArtworkInfo): Promise<{ error?: string } | null | undefined>;
    /** Store our copy of the icon image (rpc.steamStoreSaveIcon): its path and the value it replaces. */
    saveIcon(
        appid: number,
        url: string,
        source: RecordIconInfo["source"],
        steamAppid?: number,
        base64?: string,
    ): Promise<{ path?: string; previous?: string; error?: string } | null | undefined>;
    /** Remember the icon set; `{ error }` = the match changed meanwhile (undo the write). */
    recordIcon(appid: number, info: RecordIconInfo): Promise<{ error?: string } | null | undefined>;
} = {
    isEnabled: () => true,
    reportError: () => {},
    downloadImage: async () => undefined,
    recordArtwork: async () => undefined,
    saveIcon: async () => undefined,
    recordIcon: async () => undefined,
};
