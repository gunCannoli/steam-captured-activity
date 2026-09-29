// Surface `artwork` (migration plan M3.9, record-driven since M5c, ADR-0039): the only code that
// writes a shortcut's custom artwork slots and logo position. No hooks. `render(appid, record)`
// executes the plan app/artwork.ts put in `record.artwork` (which slots to clear, which to
// write from which URLs); it never decides what art a game gets.
import type { ArtworkPlan } from "../../kernel/record";
import type { Surface, SurfaceDeps } from "../../kernel/surface";
import { applyCustomArtworkFromUrls } from "./artwork";
import { deps, type RecordArtworkInfo } from "./deps";
import { clearLogoPosition, ensureLogoPosition } from "./logo";

/** Clear one slot this plugin wrote. Called on the object: never extract the method. */
async function clearSlot(appid: number, slot: number): Promise<void> {
    if (!deps.isEnabled("artwork")) return;
    const apps = (window as any).SteamClient?.Apps;
    await apps?.ClearCustomArtworkForApp?.(appid, slot);
}

const union = (a: readonly number[], b: readonly number[]) => [...new Set([...a, ...b])].sort((x, y) => x - y);

async function execute(appid: number, plan: ArtworkPlan): Promise<void> {
    if (!deps.isEnabled("artwork")) return;

    for (const slot of plan.clear) {
        try {
            await clearSlot(appid, slot);
        } catch {}
    }
    if (plan.clear.includes(2)) await clearLogoPosition(appid);

    let written: number[] = [];
    if (plan.write.length > 0) {
        written = await applyCustomArtworkFromUrls(appid, plan.urls);
        const info: RecordArtworkInfo = {
            source: plan.source === "steamgriddb" ? "steamgriddb" : "steam-cdn",
            steamAppid: plan.steamAppid,
            // SteamGridDB: the backend unions with what it already holds; Steam CDN: kept + written.
            slots: plan.source === "steamgriddb" ? written : union(plan.kept, written),
            failed: plan.write.filter((s) => !written.includes(s)),
            tried: plan.tried,
        };
        const res = await deps.recordArtwork(appid, info);
        if (res?.error) {
            // The mapping was cleared while we were writing: remove what we just wrote (P4 H5).
            for (const slot of written) {
                try {
                    await clearSlot(appid, slot);
                } catch {}
            }
            return;
        }
    }
    // Parity E: our logo needs a position or Steam never draws it.
    if (union(plan.kept, written).includes(2)) await ensureLogoPosition(appid);
}

/** One plan at a time per shortcut (a Clear followed by a write must not interleave). */
const queues = new Map<number, Promise<void>>();

export function createArtworkSurface(d: SurfaceDeps & Pick<typeof deps, "downloadImage" | "recordArtwork">): Surface {
    deps.isEnabled = d.isEnabled;
    deps.reportError = d.reportError;
    deps.downloadImage = d.downloadImage;
    deps.recordArtwork = d.recordArtwork;
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
        render(appid, record) {
            const part = record?.artwork;
            if (part?.status !== "ok" || !part.data) return;
            const plan = part.data;
            const next = (queues.get(appid) ?? Promise.resolve())
                .then(() => execute(appid, plan))
                .catch((err) => deps.reportError("artwork", err));
            queues.set(appid, next);
        },
        clear() {},
        uninstall() {},
    };
}
