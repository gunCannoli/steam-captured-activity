import { toShortcutId } from "../kernel/appid";
import type { Resolution } from "../domain/routing/policy";
import type { GameMetadata, Identity, Part } from "../kernel/record";
import { handleSteamStoreView, leaveSteamStore } from "./steam-store";
import { loadAchievementsForApp } from "./achievements";

import { handleGameOpenUpdate } from "./scraper/on-update";

/** Structural match of app/routing's public shape (no import: ADR-0039 layers). */
interface RoutingSource {
    getBucket(appid: number): Resolution;
    waitForCollections(timeoutMs?: number): Promise<boolean>;
}

/** Routing; wired to the app/routing instance in index.tsx (plan § 7.0 D3). */
let routing: RoutingSource = {
    getBucket: () => ({ bucket: "none", via: "pending" }),
    waitForCollections: async () => false,
};

export function setRouting(r: RoutingSource): void {
    routing = r;
}

/** Structural match of app/identity's public shape (no import: ADR-0039 layers). */
interface IdentitySource {
    ensure(appid: number, route: { bucket: "steam-store" | "web-scraping" | "none"; via: string }): Promise<Part<Identity>>;
}

/** Identity; wired to the app/identity instance in index.tsx (plan § 7.0 D3). */
let identity: IdentitySource = { ensure: async () => ({ status: "pending" }) };

export function setIdentity(i: IdentitySource): void {
    identity = i;
}

/** Structural match of app/metadata's public shape (no import: ADR-0039 layers). */
interface MetadataSource {
    ensure(
        appid: number,
        route: { bucket: "steam-store" | "web-scraping" | "none"; via: string },
        identity: Part<Identity> | undefined,
    ): Promise<Part<GameMetadata>>;
}

/** Metadata; wired to the app/metadata instance in index.tsx (plan § 7.0 D3). */
let metadata: MetadataSource = { ensure: async () => ({ status: "pending" }) };

export function setMetadata(m: MetadataSource): void {
    metadata = m;
}

/** Appids currently being dispatched (desktop and Big Picture can both fire). */
const inflight = new Set<number>();
/** Views seen before collections were ready; replayed once they are. */
const deferred = new Set<number>();
/** A view that arrived while the same appid was in flight; replayed once afterwards (P4 H6). */
const rerun = new Set<number>();
/** Appids currently showing the Steam Store bucket's data (for leaveSteamStore below). */
const inSteamStore = new Set<number>();

/** Route a view of a shortcut to the handler for its bucket (ADR-0033). */
export async function onSourceView(appid: number): Promise<void> {
    const rawAppid = toShortcutId(appid);
    if (rawAppid === undefined) return;
    if (inflight.has(rawAppid)) {
        rerun.add(rawAppid);
        return;
    }
    inflight.add(rawAppid);
    try {
        const { bucket, via } = routing.getBucket(rawAppid);
        const route = { bucket, via };
        if (via === "pending") {
            // Local Game Info only until collections load (ADR-0035); replayed then.
            deferred.add(rawAppid);
            await metadata.ensure(rawAppid, route, undefined);
            void loadAchievementsForApp(rawAppid, 0);
            void handleGameOpenUpdate(rawAppid);
            return;
        }
        if (bucket === "steam-store") {
            // ADR-0036: Steam Store first; no Steam match -> web scraping fallback;
            // not known yet (title missing) -> local Game Info only.
            const identityPart = await identity.ensure(rawAppid, route);
            const matched = await handleSteamStoreView(rawAppid, identityPart);
            if (matched === true) inSteamStore.add(rawAppid);
            await metadata.ensure(rawAppid, route, identityPart);
            if (matched !== true) {
                void loadAchievementsForApp(rawAppid, 0);
            }
        } else {
            // web-scraping or none. Came from steam-store: drop its artwork memory first;
            // metadata is record-driven and reverts itself on the new route's result.
            if (inSteamStore.delete(rawAppid)) leaveSteamStore(rawAppid);
            await metadata.ensure(rawAppid, route, undefined);
            void loadAchievementsForApp(rawAppid, 0);
        }

        // Smart On-Update check: activities, achievements & metadata in the background
        void handleGameOpenUpdate(rawAppid);
    } finally {
        inflight.delete(rawAppid);
        if (rerun.delete(rawAppid)) void onSourceView(rawAppid);
    }
}

/**
 * Replays views that arrived before collections were ready. Views themselves come from
 * the view sensor (sensors/view, migration plan M2): index.tsx subscribes onSourceView to
 * shortcut.viewed. A Steam render never triggers a view (M0a).
 */
export function initSourceView(): void {
    void routing.waitForCollections().then(() => {
        const list = [...deferred];
        deferred.clear();
        list.forEach((a) => void onSourceView(a));
    });
}
