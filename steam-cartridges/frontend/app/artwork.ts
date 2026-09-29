// app/artwork: decides which art a shortcut gets and puts the plan in its record; the
// artwork surface only executes it (migration plan M5c, D4). One EnsureFresh(["artwork"])
// per shortcut per session; the pure plan comes from domain/art-plan.
import { logger } from "../logger.ts";
import type { ShortcutId } from "../kernel/appid";
import type { ArtworkPlan, ArtworkUrls, Identity, Part, RecordStore, StoreApplied } from "../kernel/record";
import type { backend as Backend } from "../ports/backend";
import { assetUrlsFromItem } from "../domain/store-item.ts";
import { artworkPlan, pickUrls, sgdbPlan, slotList } from "../domain/art-plan.ts";

export interface ArtworkRoute {
    bucket: "steam-store" | "web-scraping" | "none";
    via: string;
}

/** A failed lookup is retried on a view after this long (as identity). */
const RETRY_MS = 5 * 60_000;

export interface ArtworkDeps {
    backend: Pick<typeof Backend, "ensureFresh">;
    records: RecordStore;
    /** Creates the base record if the appid has none yet (app/records.ts ensureBase). */
    ensureBase(appid: ShortcutId): void;
    titleOf(appid: number): string | undefined;
    /** The mapped native's StoreItemCache item (sensors/store-item), for its hashed art URLs. */
    storeItemFor(steamAppid: number): Promise<any | null>;
    /** services.steamgriddbEnabled and the routing rules for "steamgriddb". */
    allowSgdb(appid: ShortcutId): boolean;
    now(): number;
}

export interface ArtworkResolver {
    ensure(appid: ShortcutId, route: ArtworkRoute, identity: Part<Identity> | undefined): Promise<Part<ArtworkPlan>>;
    /** Drop this session's memory so the next ensure asks the backend again. */
    invalidate(appid: ShortcutId): void;
    /** Ask the surface to clear these slots (Clear / re-map); the backend already forgot them. */
    clearSlots(appid: ShortcutId, slots: number[]): void;
}

/** The backend's `artwork` part data (backend/art_service.lua). */
interface RawArtwork {
    urls: ArtworkUrls;
    source: "steam-cdn" | "steamgriddb";
    steamAppid?: number;
    applied?: StoreApplied | null;
    emptySlots?: unknown;
}

const union = (a: number[], b: number[]) => [...new Set([...a, ...b])].sort((x, y) => x - y);

export function buildPlan(raw: RawArtwork, at: number): ArtworkPlan {
    const applied = raw.applied && typeof raw.applied === "object" ? raw.applied : null;
    if (raw.source === "steam-cdn" && raw.steamAppid !== undefined) {
        const plan = artworkPlan(applied, raw.steamAppid, false);
        const kept = applied && applied.steam_appid === raw.steamAppid ? slotList(applied.slots) : [];
        return { source: "steam-cdn", steamAppid: raw.steamAppid, urls: pickUrls(raw.urls, plan.write), write: plan.write, clear: plan.clear, tried: [], kept, at };
    }
    const plan = sgdbPlan(raw.urls, raw.emptySlots);
    const ours = applied && applied.source === "steamgriddb" ? applied : null;
    return {
        source: "steamgriddb",
        urls: pickUrls(raw.urls, plan.write),
        write: plan.write,
        clear: [],
        tried: union(slotList(ours?.tried), plan.write),
        kept: slotList(ours?.slots),
        at,
    };
}

export function createArtwork(deps: ArtworkDeps): ArtworkResolver {
    const resolved = new Set<ShortcutId>();
    const inflight = new Map<ShortcutId, Promise<Part<ArtworkPlan>>>();
    const retryAt = new Map<ShortcutId, number>();

    async function resolve(appid: ShortcutId, route: ArtworkRoute, identity: Part<Identity> | undefined): Promise<Part<ArtworkPlan>> {
        if (route.bucket === "none") {
            const part: Part<ArtworkPlan> = { status: "unsupported" };
            resolved.add(appid);
            deps.records.update(appid, { artwork: part });
            return part;
        }
        // steam-store: wait until identity is known (the backend would say pending too).
        if (route.bucket === "steam-store" && (!identity || identity.status === "pending" || identity.status === "error")) {
            return { status: "pending" };
        }

        const native = identity?.data?.native?.appid;
        let artUrls: ArtworkUrls | undefined;
        if (native !== undefined) {
            const item = await deps.storeItemFor(native);
            if (item) artUrls = assetUrlsFromItem(item);
        }

        const res = await deps.backend.ensureFresh(appid, ["artwork"], {
            title: deps.titleOf(appid) ?? "",
            route,
            identity,
            artUrls,
            allowSgdb: deps.allowSgdb(appid),
        });
        const raw = res.error ? undefined : (res.parts.artwork as Part<RawArtwork> | undefined);

        let part: Part<ArtworkPlan>;
        if (raw?.status === "ok" && raw.data) {
            part = { status: "ok", source: raw.source, checkedAt: raw.checkedAt, data: buildPlan(raw.data, deps.now()) };
            resolved.add(appid);
            retryAt.delete(appid);
        } else if (raw) {
            const { data: _drop, ...rest } = raw;
            part = rest as Part<ArtworkPlan>;
            if (raw.status === "unsupported") resolved.add(appid);
        } else {
            part = { status: "error", message: res.error ?? "no artwork part" };
        }
        if (part.status === "error") {
            resolved.add(appid);
            retryAt.set(appid, deps.now() + RETRY_MS);
        }
        logger.info(`Artwork ${appid}: ${part.status} ${part.data ? `${part.data.source} write=[${part.data.write}]` : "-"}`);
        deps.records.update(appid, { artwork: part });
        return part;
    }

    return {
        async ensure(appid, route, identity) {
            if (resolved.has(appid)) {
                const at = retryAt.get(appid);
                if (at === undefined || deps.now() < at) return deps.records.get(appid)?.artwork ?? { status: "pending" };
                retryAt.delete(appid);
                resolved.delete(appid);
            }
            const existing = inflight.get(appid);
            if (existing) return existing;
            const promise = resolve(appid, route, identity).finally(() => inflight.delete(appid));
            inflight.set(appid, promise);
            return promise;
        },
        invalidate(appid) {
            resolved.delete(appid);
            retryAt.delete(appid);
            inflight.delete(appid);
        },
        clearSlots(appid, slots) {
            if (slots.length === 0) return;
            deps.ensureBase(appid);
            const plan: ArtworkPlan = { source: "cleared", urls: {}, write: [], clear: slots, tried: [], kept: [], at: deps.now() };
            deps.records.update(appid, { artwork: { status: "ok", data: plan } });
        },
    };
}
