// Surface `captures` (migration plan M3.2, ADR-0039): the only code that writes Steam's
// spotlight, activity and StoreItemCache stores and the activity feed's jsx, from Steam's
// own captures (ADR-0022). Takes over the kill switches `captures`, `store-cache`,
// `headline` and `activity-cards` (plan § 7.0 D6).
import type { Surface, SurfaceDeps } from "../../kernel/surface";
import { ensureStoreCacheHooked, setNativeActivitySource } from "./activity";
import { installActivityCardsPatch } from "./activity-cards";
import { installBpmStyle } from "./bpm-style";
import { deps, type ActivityOptions } from "./deps";
import { installHeadlinePatch } from "./headline";
import { patch, unpatch } from "./publish";

export { patch, refresh, setContentListener, unpatch } from "./publish";
export { setNativeActivitySource } from "./activity";
export { addSessionAchievement } from "./session";
export { registerSummaryProvider } from "./summary";
export type { SummaryContext, SummaryContribution, SummaryProvider } from "./summary";
export { headlineJsxDiagnostics } from "./headline";
export { activityCardsJsxDiagnostics } from "./activity-cards";

/** Install one part under its own kill switch; a failure counts against that switch only. */
function part(id: string, install: () => unknown): void {
    if (!deps.isEnabled(id)) return;
    try {
        install();
    } catch (err) {
        deps.reportError(id, err);
    }
}

export function createCapturesSurface(d: SurfaceDeps & { activityOptions(): ActivityOptions }): Surface {
    deps.isEnabled = d.isEnabled;
    deps.reportError = d.reportError;
    deps.activityOptions = d.activityOptions;
    return {
        id: "captures",
        touches: [
            "AppSpotlightStore.GetOrCreateAppData",
            "AppSpotlightStore.m_session.AddAchievement",
            "AppActivityStore.m_mapAppActivity",
            "StoreItemCache.m_mapApps",
            "StoreItemCache.m_setUnavailableApps",
            "StoreItemCache.BIsAppMissing",
            "CWorkshopStore.m_mapPublishedFiles",
            "jsx:headline",
            "jsx:activity-cards",
            "BPM.style#nsga-bpm-activity-thumbs",
        ],
        reads: ["identity"],
        install() {
            part("store-cache", ensureStoreCacheHooked);
            part("headline", installHeadlinePatch);
            part("activity-cards", installActivityCardsPatch);
            installBpmStyle();
        },
        render(appid, record) {
            // Captures are Steam's own data, read live (ADR-0022); only the native
            // activity source (a mapped shortcut's Steam Store match) is record-driven.
            setNativeActivitySource(appid, record?.identity?.data?.native?.appid);
            void patch(appid);
        },
        clear: (appid) => unpatch(appid),
        uninstall() {
            /* the patches stay until Steam restarts, as before M3.2 */
        },
    };
}
