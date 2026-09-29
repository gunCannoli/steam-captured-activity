// Surface `library-home` (migration plan M3.10, ADR-0039): fills in the library grid's
// "last played" fields of shortcuts from capture timestamps, through
// collectionStore.OnAppOverviewChange. Registration is async (it waits for the stats and
// the store); install() starts it and ready() lets index.tsx keep its start-up order.
import type { Surface, SurfaceDeps } from "../../kernel/surface";
import { deps, register } from "./grid";

export { refresh } from "./grid";

let registration: Promise<unknown> = Promise.resolve();

/** Resolves when the grid patch is registered (or failed); never rejects. */
export function ready(): Promise<void> {
    return registration.then(
        () => undefined,
        () => undefined,
    );
}

export function createLibraryHomeSurface(
    d: SurfaceDeps & {
        loadLibraryStats(): Promise<Record<string, { newest?: number; screenshots?: number }>>;
    },
): Surface {
    deps.isEnabled = d.isEnabled;
    deps.reportError = d.reportError;
    deps.loadLibraryStats = d.loadLibraryStats;
    return {
        id: "library-home",
        touches: [
            "collectionStore.OnAppOverviewChange",
            "AppOverview.rt_recent_activity_time",
            "AppOverview.rt_last_time_played_or_installed",
        ],
        reads: [],
        install() {
            registration = register().catch((err) => deps.reportError("library-home", err));
        },
        render() {
            /* stats stay an RPC until M7 decides (plan § 7.0 D4) */
        },
        clear() {},
        uninstall() {
            /* the patch stays until Steam restarts, as before M3.10 */
        },
    };
}
