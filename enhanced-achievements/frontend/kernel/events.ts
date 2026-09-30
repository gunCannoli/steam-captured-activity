/**
 * Kernel: the typed in-process event bus (migration plan § 4.4). Same shape as
 * steam-cartridges/frontend/kernel/events.ts. Sensors emit, surfaces subscribe.
 * A handler that throws is passed to the error sink and skipped; it never stops
 * the other handlers or the emitter. Pure.
 */
import type { SteamNotification } from './notification.ts';

export interface Events {
    /** A real or test unlock was shown for the first time: once per notification data object, never for a
     *  preview or the synthetic 100% toast. Emitted one macrotask after Steam's call (D4). */
    'achievement.unlocked': { n: SteamNotification; atMs: number; completesGame: boolean };
}

export type EventName = keyof Events;
type Handler<K extends EventName> = (payload: Events[K]) => void;

export interface EventBus {
    on<K extends EventName>(event: K, handler: (payload: Events[K]) => void): () => void;
    emit<K extends EventName>(event: K, payload: Events[K]): void;
    count(event: EventName): number;
}

/** Handlers run in registration order; one that throws is passed to onError and the rest still run. */
export function createEventBus(onError: (event: EventName, err: unknown) => void = () => {}): EventBus {
    const handlers = new Map<EventName, Set<Handler<EventName>>>();
    return {
        on(event, handler) {
            let set = handlers.get(event);
            if (!set) handlers.set(event, (set = new Set()));
            set.add(handler as Handler<EventName>);
            return () => {
                set!.delete(handler as Handler<EventName>);
            };
        },
        emit(event, payload) {
            const set = handlers.get(event);
            if (!set) return;
            for (const handler of [...set]) {
                try {
                    handler(payload);
                } catch (err) {
                    try {
                        onError(event, err);
                    } catch {
                        /* an error sink must never break emit */
                    }
                }
            }
        },
        count: (event) => handlers.get(event)?.size ?? 0,
    };
}
