// Surface `artwork`: the shortcut's library icon (icon plan). Not a SetCustomArtworkForApp slot:
// Steam draws a shortcut's icon from the file its shortcuts.vdf `icon` field names, or from the
// exe when that is empty (32 px, pixelated when scaled up). The backend stores our copy of the
// image; this points the shortcut at it with SteamClient.Apps.SetShortcutIcon, which rewrites
// shortcuts.vdf and swaps the overview's icon_data at once. Runtime imports carry `.ts` so Node
// can run tests/artwork-icon.test.ts.
import { logger } from "../../logger.ts";
import type { IconPlan } from "../../kernel/record";
import { deps, type RecordIconInfo } from "./deps.ts";

/** Called on the object: never extract the method. False when Steam has no such call. */
async function setShortcutIcon(appid: number, path: string): Promise<boolean> {
    const apps = (globalThis as any).SteamClient?.Apps;
    if (typeof apps?.SetShortcutIcon !== "function") {
        logger.warn("SteamClient.Apps.SetShortcutIcon is not available.");
        return false;
    }
    await apps.SetShortcutIcon(appid, path);
    return true;
}

/** Write the icon (`url`) or put back the one ours replaced (`restore`). Kill switch: `artwork`. */
export async function applyIcon(
    appid: number,
    plan: IconPlan,
    source: RecordIconInfo["source"],
    steamAppid?: number,
): Promise<void> {
    if (!deps.isEnabled("artwork")) return;
    if ("restore" in plan) {
        if (await setShortcutIcon(appid, plan.restore)) logger.info(`Restored the library icon for appid ${appid}`);
        return;
    }
    const saved = await deps.saveIcon(appid, plan.url, source, steamAppid);
    if (!saved?.path || saved.error) {
        logger.warn(`Library icon for appid ${appid} not stored: ${saved?.error ?? "no response"}`);
        return;
    }
    const previous = saved.previous ?? "";
    if (!(await setShortcutIcon(appid, saved.path))) return;
    const res = await deps.recordIcon(appid, { path: saved.path, previous, source, steamAppid });
    if (res?.error) {
        // The match changed while we were writing: put the replaced icon back (as the slots, P4 H5).
        await setShortcutIcon(appid, previous);
        return;
    }
    logger.info(`Set the library icon for appid ${appid}`);
}
