# M0a literal before/after blocks (docs/plans/steam-cartridges-architecture-migration-plan.md § M0a).
# Every "before" block must occur exactly once, or the plan is stale.
#   python scratch/arch-m0/m0a_blocks.py <steam-cartridges dir> check   -> verifies only
#   python scratch/arch-m0/m0a_blocks.py <steam-cartridges dir> apply   -> writes the edits
import os
import sys

GIP = "frontend/features/game-info/game-info-patch.ts"
MET = "frontend/features/game-info/metadata.ts"
SRV = "frontend/features/source-view.ts"
STEPS = []


def step(n, path, before, after):
    STEPS.append((n, path, before, after))


step("1.1", MET,
"""/** Values Steam had before our first enrichment, per appid (for revert). */
const originals = new Map<number, Partial<Originals>>();
""",
"""/** Values Steam had before our first enrichment, per appid (for revert). */
const originals = new Map<number, Partial<Originals>>();

/**
 * What enrichGameDetails last wrote, per unsigned appid. A repeat call with the same
 * metadata and badges, while Steam still holds our descriptionsData object, writes
 * nothing: a rewrite calls AppDetailsChanged, which re-renders Game Info, and a render
 * must never cause another render (M0a: render feedback loop hung SharedJSContext).
 */
const applied = new Map<
    number,
    { signature: string; descriptionsData: unknown; categoryIds: number[] }
>();

/** JSON of each metadata object, computed once (renders call enrichGameDetails). */
const metaJson = new WeakMap<object, string>();

/**
 * Steam rebuilds an AppOverview's fields when it refreshes the app, which drops our
 * release date and badge categories. The enrichment is only live if they are still there.
 */
function overviewStillEnriched(
    overview: any,
    meta: ConsolidatedMetadata,
    categoryIds: number[],
): boolean {
    if (!overview) return false;
    if (meta.release_date && meta.release_date > 0) {
        const expected = meta.original_release_date || meta.release_date;
        if (overview.rt_original_release_date !== expected) return false;
    }
    for (const id of categoryIds) {
        if (!overview.m_setStoreCategories?.has?.(id)) return false;
    }
    return true;
}
""")

step("1.2", MET,
"""        let touched = false;
        const uAppid = appid >>> 0;
        markAppEnriched(uAppid);
""",
"""        let touched = false;
        const uAppid = appid >>> 0;

        // Idempotent (M0a): identical data already live in Steam -> no write, no re-render.
        let json = metaJson.get(meta);
        if (json === undefined) {
            json = JSON.stringify(meta);
            metaJson.set(meta, json);
        }
        const categoryIds = badgeCategoryIds(meta, controllerContext(uAppid));
        const signature = json + "|" + categoryIds.join(",");
        const previous = applied.get(uAppid);
        if (previous && previous.signature === signature) {
            const liveData =
                getAppDetailsStore()?.GetAppData?.(uAppid) ||
                getAppDetailsStore()?.GetAppData?.(appid | 0);
            const liveOverview =
                getAppStore()?.GetAppOverviewByAppID?.(uAppid) ||
                getAppStore()?.GetAppOverviewByAppID?.(appid | 0);
            if (
                liveData &&
                liveData.descriptionsData === previous.descriptionsData &&
                overviewStillEnriched(liveOverview, meta, previous.categoryIds)
            ) {
                return true;
            }
        }

        markAppEnriched(uAppid);
""")

step("1.3", MET,
"""                // Notify mobx observers if available
                if (typeof detailsStore.AppDetailsChanged === "function") {
                    try {
                        detailsStore.AppDetailsChanged(uAppid);
                    } catch {}
                }
                touched = true;
""",
"""                // Notify mobx observers if available
                if (typeof detailsStore.AppDetailsChanged === "function") {
                    try {
                        detailsStore.AppDetailsChanged(uAppid);
                    } catch {}
                }
                applied.set(uAppid, {
                    signature,
                    descriptionsData: appData.descriptionsData,
                    categoryIds,
                });
                touched = true;
""")

step("1.4", MET,
"""        originals.delete(appid);
        originals.delete(uAppid);
""",
"""        originals.delete(appid);
        originals.delete(uAppid);
        applied.delete(uAppid);
""")

step("2.1", GIP,
"""                    const rawAppid = overview.appid >>> 0;
                    if (options.onView) {
                        onTriggerAppView?.(rawAppid);
                    }

                    if (options.requireMetadata) {
""",
"""                    const rawAppid = overview.appid >>> 0;

                    if (options.requireMetadata) {
""")

step("2.2", GIP,
"""    options: {
        requireMetadata?: boolean;
        onView?: boolean;
    },
""",
"""    options: {
        requireMetadata?: boolean;
    },
""")

step("2.3", GIP,
"""            hookComponentProps(targetG, {
                requireMetadata: true,
                onView: true,
            });
""",
"""            hookComponentProps(targetG, {
                requireMetadata: true,
            });
""")

step("2.4", GIP,
"""                        const rawAppid = overview.appid >>> 0;
                        onTriggerAppView?.(rawAppid);

                        const store = getAppDetailsStore();
                        let appData =
                            store?.GetAppData?.(overview.appid) ||
                            store?.GetAppData?.(rawAppid);

                        if (
                            !appData?.descriptionsData?.strSnippet &&
                            onGetMetadata &&
""",
"""                        const rawAppid = overview.appid >>> 0;

                        const store = getAppDetailsStore();
                        let appData =
                            store?.GetAppData?.(overview.appid) ||
                            store?.GetAppData?.(rawAppid);

                        // Every render re-checks: enrichGameDetails is a no-op while our data is
                        // live, and re-applies once after Steam rebuilds the overview (M0a).
                        if (
                            onGetMetadata &&
""")

step("2.9", GIP,
"""                if (
                    !appData?.descriptionsData?.strSnippet &&
                    onGetMetadata &&
                    onEnrichGameDetails
                ) {
""",
"""                // Every render re-checks: enrichGameDetails is a no-op while our data is
                // live, and re-applies once after Steam rebuilds the overview (M0a).
                if (onGetMetadata && onEnrichGameDetails) {
""")

step("2.5", GIP,
"""let onTriggerAppView: ((appid: number) => void) | undefined;
let onGetMetadata: ((appid: number) => any) | undefined;
let onEnrichGameDetails: ((appid: number, meta: any) => boolean) | undefined;

export function setAppViewTrigger(fn: (appid: number) => void): void {
    onTriggerAppView = fn;
}
""",
"""let onGetMetadata: ((appid: number) => any) | undefined;
let onEnrichGameDetails: ((appid: number, meta: any) => boolean) | undefined;
""")

step("2.6", SRV,
"""import { setAppViewTrigger } from "./game-info/game-info-patch";
""",
"")

step("2.7", SRV,
"""    setAppViewTrigger((appid) => void onSourceView(appid));
""",
"")

step("2.8", SRV,
"""/** Wires every place a game page can open (game-info patch, Big Picture, desktop). */""",
"""/**
 * Wires every place a game page can open (Big Picture, desktop). A Steam render never
 * triggers a view: that closed a render -> enrich -> re-render loop (M0a).
 */""")

step("3.1", GIP,
"""        if (popupMgr?.m_mapPopups) {
            for (const popup of popupMgr.m_mapPopups.values()) {
                const doc =
                    popup?.m_popup?.window?.document || popup?.window?.document;
                if (doc && !docs.includes(doc)) {
                    docs.push(doc);
                }
            }
        }
""",
"""        // Only the main window and Big Picture host Game Info. Never walk other popups
        // (Properties, dialogs): force-updating their trees hung SharedJSContext (M0a).
""")

step("3.2", GIP,
"""                    (fiber.type.name === "k" ||
                        fiber.type.name === "G" ||
                        fiber.type.name === "ct" ||
                        fiber.type.name === "be" ||
                        Boolean(fiber.type.s_setGameInfoVisible) ||
                        typeof fiber.type.prototype?.onCollapseStarted ===
                            "function" ||
                        typeof fiber.type === "function")
""",
"""                    (fiber.type.__nsga_props_hooked === true ||
                        fiber.type.__nsga_gameinfo_patched === true)
""")

if __name__ == "__main__":
    root = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else "check"
    for n, path, before, after in STEPS:
        p = os.path.join(root, path)
        with open(p, encoding="utf-8", newline="") as f:
            src = f.read()
        eol = "\r\n" if "\r\n" in src else "\n"  # match the file's own line endings
        before = before.replace("\n", eol)
        after = after.replace("\n", eol)
        c = src.count(before)
        if c != 1:
            print(f"STEP {n}: before-block found {c} times in {path} -> STALE")
            sys.exit(1)
        if mode == "apply":
            with open(p, "w", encoding="utf-8", newline="") as f:
                f.write(src.replace(before, after))
        print(f"STEP {n}: ok ({path})")
