// Surface `artwork`: what the composition root gives it (migration plan M3.9, § 7.0 D3/D6).
import type { SurfaceDeps } from "../../kernel/surface";

export const deps: SurfaceDeps & {
    /** The backend image fetch for Steam CDN URLs (rpc.steamStoreDownloadImage). */
    downloadImage(url: string): Promise<{ base64?: string; ext?: string } | null | undefined>;
} = { isEnabled: () => true, reportError: () => {}, downloadImage: async () => undefined };
