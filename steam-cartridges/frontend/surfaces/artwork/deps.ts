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

export const deps: SurfaceDeps & {
    /** The backend image fetch for Steam CDN URLs (rpc.steamStoreDownloadImage). */
    downloadImage(url: string): Promise<{ base64?: string; ext?: string } | null | undefined>;
    /** Remember the slots written; `{ error }` = the mapping vanished meanwhile (undo the write). */
    recordArtwork(appid: number, info: RecordArtworkInfo): Promise<{ error?: string } | null | undefined>;
} = {
    isEnabled: () => true,
    reportError: () => {},
    downloadImage: async () => undefined,
    recordArtwork: async () => undefined,
};
