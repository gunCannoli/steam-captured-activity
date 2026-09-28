// Kernel: the typed in-process event bus (migration plan M1, ADR-0039).
// Sensors emit, app/ and surfaces subscribe. A handler that throws is logged and
// skipped; it never stops the other handlers or the emitter.
import type { ShortcutId } from "./appid";
import type { RecordPart } from "./record";

export interface Events {
    /** The user opened a shortcut's page (desktop route or Big Picture), deduplicated per appid. */
    "shortcut.viewed": { appid: ShortcutId; mode: "desktop" | "gamepad" };
    /** The user left a shortcut's page. */
    "shortcut.left": { appid: ShortcutId; mode: "desktop" | "gamepad" };
    "shortcut.launched": { appid: ShortcutId; name: string };
    "shortcut.quit": { appid: ShortcutId };
    /** Parts of a GameRecord changed; surfaces re-render only if they read one of `parts`. */
    "record.updated": { appid: ShortcutId; parts: RecordPart[] };
    "achievements.unlocked": { appid: ShortcutId; ids: string[] };
    "settings.changed": { key: string };
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
