// Kernel: the typed in-process event bus (migration plan M1, ADR-0039).
// Sensors emit, app/ and surfaces subscribe. A handler that throws is logged and
// skipped; it never stops the other handlers or the emitter.
import type { ShortcutId } from "./appid";
import type { RecordPart, StoreKind } from "./record";

export interface Events {
    /** The user opened a shortcut's page (desktop route or Big Picture), deduplicated per appid. */
    "shortcut.viewed": { appid: ShortcutId; mode: "desktop" | "gamepad" };
    /** The user left a shortcut's page. */
    "shortcut.left": { appid: ShortcutId; mode: "desktop" | "gamepad" };
    "shortcut.launched": { appid: ShortcutId; name: string };
    "shortcut.quit": { appid: ShortcutId; name: string };
    /** Parts of a GameRecord changed; surfaces re-render only if they read one of `parts`. */
    "record.updated": { appid: ShortcutId; parts: RecordPart[] };
    /** New unlocks (app/achievements), with what the toast and the Post-Game Summary show. */
    "achievements.unlocked": { appid: ShortcutId; ids: string[]; items: UnlockedAchievement[] };
    /**
     * New unlocks a store sync found (Epic, Xbox; ADR-0056): the store's own overlay already showed them, so there is
     * no toast; the Post-Game Summary shows them.
     */
    "achievements.synced": { appid: ShortcutId; items: UnlockedAchievement[] };
    /** The launch toast policy (app/achievements) decided a launch gets the "Achievements Enabled" toast. */
    "achievements.launch-toast": { appid: ShortcutId };
    /** The captures surface published (or cleared) a shortcut's summary and activity (sections drops the placeholder). */
    "captures.published": { appid: ShortcutId; hasContent: boolean };
    /** What the artwork surface wrote for a plan (app/artwork records it through the port, M10). */
    "artwork.applied": {
        appid: ShortcutId;
        source: "steam-cdn" | "steamgriddb";
        steamAppid?: number;
        /** The plan's `write`, `kept` and `tried`. */
        attempted: number[];
        kept: number[];
        tried: number[];
        /** The slots Steam accepted. */
        written: number[];
        /** The library icon set, when the plan had one. */
        icon?: { path: string; previous: string };
    };
    "settings.changed": { key: string };
    /**
     * Auto-add (app/store-sync, ADR-0056): add this installed store game as a shortcut, in `collection`. The
     * library-shortcuts surface writes it and answers with `store.shortcut-added`.
     */
    "store.add-requested": {
        kind: StoreKind;
        key: string;
        title: string;
        launch: { exe: string; start_dir: string; launch_options: string };
        collection: string;
    };
    /** What the library-shortcuts surface did: the new appid (and the collection it is in), or an error. */
    "store.shortcut-added": { kind: StoreKind; key: string; appid?: number; collection?: string; error?: string };
    /**
     * U0 repair (app/store-sync, ADR-0058): an Xbox shortcut runs an older version's exe after an app update; the
     * library-shortcuts surface points it at the current one (the appid stays) and answers with `store.shortcut-repaired`.
     */
    "store.repair-requested": { appid: number; title: string; exe: string; start_dir: string };
    "store.shortcut-repaired": { appid: number; title: string; error?: string };
    /**
     * Auto-remove (app/store-sync): remove this shortcut since the game was uninstalled from its store.
     * The library-shortcuts surface removes it and answers with `store.shortcut-removed`.
     */
    "store.remove-requested": {
        kind: StoreKind;
        key: string;
        appid: number;
        title: string;
    };
    "store.shortcut-removed": { kind: StoreKind; key: string; appid: number; title?: string; error?: string };
    /**
     * Epic Steam Overlay Workaround (ADR-0057). app/epic-launcher tells the launch-hold surface which shortcuts to hold at
     * Play (the Epic launcher-link copies while the user's setting is on; empty = none); the surface reports a held launch;
     * the app answers `launch.release` once the backend has closed a running Epic launcher, and the surface lets Steam go on.
     */
    "launch.hold-mode": { appids: ShortcutId[] };
    "launch.held": { appid: ShortcutId };
    "launch.release": { appid: ShortcutId };
    /** The community surface showed Steam's viewer for a manual card (features plan F2c): app/manuals renders its pages. */
    "community.manual-opened": { appid: ShortcutId; key: string };
}

/** One new unlock, as the surfaces show it (name, description and icon from the record's schema). */
export interface UnlockedAchievement {
    id: string;
    name: string;
    description: string;
    icon: string;
    global_pct: number;
    /** Unix seconds. */
    unlockedAt: number;
}

export type EventName = keyof Events;
type Handler<K extends EventName> = (payload: Events[K]) => void;
type ErrorSink = (event: EventName, err: unknown) => void;

export interface EventBus {
    on<K extends EventName>(event: K, handler: Handler<K>): () => void;
    emit<K extends EventName>(event: K, payload: Events[K]): void;
    /** Handlers currently registered for an event (diagnostics and tests). */
    count(event: EventName): number;
}

export function createEventBus(onError: ErrorSink = () => {}): EventBus {
    const handlers = new Map<EventName, Set<Handler<any>>>();
    return {
        on(event, handler) {
            let set = handlers.get(event);
            if (!set) handlers.set(event, (set = new Set()));
            set.add(handler);
            return () => {
                set!.delete(handler);
            };
        },
        emit(event, payload) {
            const set = handlers.get(event);
            if (!set) return;
            for (const h of [...set]) {
                try {
                    h(payload);
                } catch (err) {
                    try {
                        onError(event, err);
                    } catch {
                        /* an error sink must never break emit */
                    }
                }
            }
        },
        count(event) {
            return handlers.get(event)?.size ?? 0;
        },
    };
}
