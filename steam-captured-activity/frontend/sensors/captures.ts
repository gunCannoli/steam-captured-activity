// Capture sensor: the only code that hears Steam say a screenshot or recording was saved or deleted (Steam's own
// notifications, steam/stores captureEvents). It reports the app; it writes nothing to Steam. Handlers run inside
// Steam's notification dispatch, so the report goes out on a timer (guardrail 17).
import { appidFromGameId, toUnsigned } from "../kernel/appid";
import { captureEvents } from "../steam/stores";

export type CaptureChange = "screenshot-written" | "screenshot-deleted" | "clip-created" | "clip-deleted";

let installed = false;

/** Install once. Returns how many of Steam's three event sources are live (0: only views and the sweep remain). */
export function installCaptureSensor(changed: (appid: number, what: CaptureChange) => void): number {
    if (installed) return 0;
    installed = true;
    const report = (appid: number | undefined, what: CaptureChange) => {
        if (appid !== undefined) setTimeout(() => changed(appid, what), 0);
    };
    let live = 0;
    if (
        captureEvents.onScreenshot((n) => {
            if (n?.strOperation === "written") report(toUnsigned(n.unAppID), "screenshot-written");
            else if (n?.strOperation === "deleted") report(toUnsigned(n.unAppID), "screenshot-deleted");
        })
    )
        live++;
    if (captureEvents.onClipCreated((b) => report(appidFromGameId(b?.summary?.game_id, b?.summary?.clip_id), "clip-created"))) live++;
    if (captureEvents.onClipDeleted((b) => report(appidFromGameId(b?.game_id, b?.clip_id), "clip-deleted"))) live++;
    return live;
}
