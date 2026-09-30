// app/view: what happens when the user opens a shortcut's page (migration plan M7b; moved from
// features/source-view.ts, the last features/ file of the pipeline). Route -> identity -> metadata ->
// artwork -> achievements. Each part's own service decides whether to ask the backend, and the
// backend's TTLs (fresh_policy.lua) decide whether anything is fetched, so a fresh page costs no
// network. A Steam render never starts a view (M0a): views come from sensors/view.
import { toShortcutId, type ShortcutId } from "../kernel/appid.ts";
import type { ArtworkPlan, GameMetadata, Identity, Part, Route } from "../kernel/record";

export interface ViewDeps {
    routing: {
        getBucket(appid: number): Route;
        waitForCollections(timeoutMs?: number): Promise<boolean>;
    };
    identity: { ensure(appid: ShortcutId, route: Route): Promise<Part<Identity>> };
    metadata: { ensure(appid: ShortcutId, route: Route, identity: Part<Identity> | undefined): Promise<Part<GameMetadata>> };
    artwork: { ensure(appid: ShortcutId, route: Route, identity: Part<Identity> | undefined): Promise<Part<ArtworkPlan>> };
    achievements: { ensure(appid: ShortcutId, route: Route): Promise<unknown> };
    /** The Steam Store bucket's side effects (features/steam-store): true = a Steam match, false = none. */
    steamStore: {
        onView(appid: ShortcutId, identity: Part<Identity>): Promise<boolean | undefined>;
        leave(appid: ShortcutId): void;
    };
}

export interface View {
    /** Route a view of a shortcut to the parts its bucket allows (ADR-0033). */
    onSourceView(appid: number): Promise<void>;
    /** Replay the views that arrived before collections were ready. */
    init(): void;
}

export function createView(deps: ViewDeps): View {
    /** Appids currently being dispatched (desktop and Big Picture can both fire). */
    const inflight = new Set<number>();
    /** Views seen before collections were ready; replayed once they are. */
    const deferred = new Set<number>();
    /** A view that arrived while the same appid was in flight; replayed once afterwards (P4 H6). */
    const rerun = new Set<number>();
    /** Appids currently showing the Steam Store bucket's data (for steamStore.leave). */
    const inSteamStore = new Set<number>();

    async function onSourceView(appid: number): Promise<void> {
        const id = toShortcutId(appid);
        if (id === undefined) return;
        if (inflight.has(id)) {
            rerun.add(id);
            return;
        }
        inflight.add(id);
        try {
            const { bucket, via } = deps.routing.getBucket(id);
            const route: Route = { bucket, via };
            if (via === "pending") {
                // Local Game Info only until collections load (ADR-0035); replayed then.
                deferred.add(id);
                await deps.metadata.ensure(id, route, undefined);
                return;
            }
            if (bucket === "steam-store") {
                // ADR-0036: Steam Store first; no Steam match -> the web tier (metadata); not known yet
                // (title missing) -> local Game Info only.
                const identityPart = await deps.identity.ensure(id, route);
                const matched = await deps.steamStore.onView(id, identityPart);
                if (matched === true) inSteamStore.add(id);
                await deps.metadata.ensure(id, route, identityPart);
                await deps.artwork.ensure(id, route, identityPart);
                void deps.achievements.ensure(id, route); // reads the identity just resolved from the record
            } else {
                // web-scraping or none. Came from steam-store: drop its memory first; metadata and artwork
                // are record-driven and follow the new route's result.
                if (inSteamStore.delete(id)) deps.steamStore.leave(id);
                await deps.metadata.ensure(id, route, undefined);
                await deps.artwork.ensure(id, route, undefined);
                void deps.achievements.ensure(id, route);
            }
        } finally {
            inflight.delete(id);
            if (rerun.delete(id)) void onSourceView(id);
        }
    }

    return {
        onSourceView,
        init() {
            void deps.routing.waitForCollections().then(() => {
                const list = [...deferred];
                deferred.clear();
                list.forEach((a) => void onSourceView(a));
            });
        },
    };
}
