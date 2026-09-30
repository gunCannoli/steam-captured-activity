// app/metadata: selects Game Info for a shortcut through one EnsureFresh call
// instead of the old scattered local/store/IGDB pipeline (migration plan M5b).
import type { ShortcutId } from "../kernel/appid";
import type { GameMetadata, Identity, Part, RecordStore, Route } from "../kernel/record";
import type { backend as Backend } from "../ports/backend";
import { metadataFromStoreItem } from "../domain/store-item.ts";
import { badgeCategoryIds, type ControllerContext } from "../domain/category-policy.ts";

export interface MetadataDeps {
    backend: Pick<typeof Backend, "ensureFresh" | "getAllRecords">;
    records: RecordStore;
    titleOf(appid: number): string | undefined;
    /** Creates the base record if the appid has none yet (app/records.ts ensureBase). */
    ensureBase(appid: ShortcutId): void;
    /** The mapped native's StoreItemCache item, loaded by sensors/store-item. */
    storeItemFor(steamAppid: number): Promise<any | null>;
    /** services.igdbEnabled and the routing service check for "igdb". */
    allowWeb(appid: ShortcutId): boolean;
    /** services.screenscraperEnabled and the routing service check for "screenscraper". */
    allowScreenscraper(appid: ShortcutId): boolean;
    /** What decides the controller badge without Steam Store data (app/controller + setting defaultFullController). */
    controller(appid: ShortcutId): ControllerContext;
}

export interface MetadataResolver {
    ensure(appid: ShortcutId, route: Route, identity: Part<Identity> | undefined, opts?: { noNetwork?: boolean }): Promise<Part<GameMetadata>>;
    /** Preload every record from the backend's disk-only bulk read (replaces initGameInfo's preload). */
    preload(): Promise<void>;
}

export function createMetadata(deps: MetadataDeps): MetadataResolver {
    /** The part with the Steam categories the game-info surface writes (ADR-0038; M10: decided here, not in the surface). */
    function withBadges(appid: ShortcutId, part: Part<GameMetadata>): Part<GameMetadata> {
        if (!part.data) return part;
        return { ...part, data: { ...part.data, badge_category_ids: badgeCategoryIds(part.data, deps.controller(appid)) } };
    }

    async function ensure(
        appid: ShortcutId,
        route: Route,
        identity: Part<Identity> | undefined,
        opts: { noNetwork?: boolean } = {},
    ): Promise<Part<GameMetadata>> {
        const native = identity?.data?.native?.appid;
        let storeItem: GameMetadata | null | undefined;
        if (route.bucket === "steam-store" && native !== undefined && !opts.noNetwork) {
            const item = await deps.storeItemFor(native);
            storeItem = item ? metadataFromStoreItem(item, native, appid) : null;
        }

        const res = await deps.backend.ensureFresh(appid, ["metadata"], {
            title: deps.titleOf(appid) ?? "",
            route,
            identity,
            storeItem: storeItem ?? undefined,
            allowWeb: deps.allowWeb(appid),
            allowScreenscraper: deps.allowScreenscraper(appid),
            noNetwork: opts.noNetwork,
        });

        const raw = res.error ? undefined : (res.parts.metadata as Part<GameMetadata> | undefined);
        const part: Part<GameMetadata> = withBadges(appid, raw ?? { status: "error", message: res.error ?? "no metadata part" });
        deps.records.update(appid, { metadata: part });
        return part;
    }

    return {
        ensure,
        async preload() {
            const res = await deps.backend.getAllRecords();
            for (const [key, parts] of Object.entries(res.records ?? {})) {
                const appid = Number(key) as ShortcutId;
                if (!Number.isFinite(appid)) continue;
                // Metadata only. Writing `identity` here would make every record-driven surface react at
                // start-up, and `captures` calls Steam's GetAppActivity for each mapped native app before
                // Steam is ready (the fetch then sticks at "requested" with no events, seen live in M5).
                // Identity is resolved on the first view of a shortcut, as before.
                if (!parts.metadata) continue;
                deps.ensureBase(appid);
                deps.records.update(appid, { metadata: withBadges(appid, parts.metadata as Part<GameMetadata>) });
            }
        },
    };
}
