// Surface `artwork` (migration plan M3.9, ADR-0039): the only code that writes a shortcut's
// custom artwork slots and logo position. No hooks. The Steam Store pipeline reaches it only
// through the sink wired in index.tsx (plan § 7.0 D3); the art plan stays in the pipeline (M4).
import type { Surface, SurfaceDeps } from "../../kernel/surface";
import { applyCustomArtworkFromUrls } from "./artwork";
import { deps } from "./deps";
import { clearLogoPosition, ensureLogoPosition } from "./logo";

/** Clear one slot this plugin wrote. Called on the object: never extract the method. */
async function clearSlot(appid: number, slot: number): Promise<void> {
    if (!deps.isEnabled("artwork")) return;
    const apps = (window as any).SteamClient?.Apps;
    await apps?.ClearCustomArtworkForApp?.(appid, slot);
}

/** What features/steam-store calls (structurally matched by setArtworkSink). */
export const artworkWriter = {
    applyFromUrls: applyCustomArtworkFromUrls,
    clearSlot,
    ensureLogoPosition,
    clearLogoPosition,
};

export function createArtworkSurface(
    d: SurfaceDeps & { downloadImage(url: string): Promise<{ base64?: string; ext?: string } | null | undefined> },
): Surface {
    deps.isEnabled = d.isEnabled;
    deps.reportError = d.reportError;
    deps.downloadImage = d.downloadImage;
    return {
        id: "artwork",
        touches: [
            "SteamClient.Apps.SetCustomArtworkForApp",
            "SteamClient.Apps.ClearCustomArtworkForApp",
            "AppDetailsStore.SaveCustomLogoPosition",
            "AppDetailsStore.ClearCustomLogoPosition",
        ],
        reads: ["artwork"],
        install() {},
        render() {
            /* record-driven (art plan from the resolver) from M4 (plan § 7.0 D4) */
        },
        clear() {},
        uninstall() {},
    };
}
