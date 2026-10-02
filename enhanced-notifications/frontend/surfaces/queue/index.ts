import type { Surface } from '../../kernel/surface';
import type { NotificationStoreHandle } from '../../steam/notification-store';
import { installStackIdle, refreshFullscreenQuery, stackLooksStuck } from '../../steam/toast-stack';
import { onSettingChange, setting } from '../../settings/settings';
import { isEnabled, reportError } from '../../safety/runtime';
import { logger } from '../../logger';
import { planAlone, type AloneEntry } from './queue';

/** How often the watchdog looks, and how many looks in a row the stack must seem stuck before it is unstuck. */
const WATCH_MS = 1000;
const STUCK_LOOKS = 2;

/**
 * Steam's own `displayToastAlone` for a type config, before any copy of this plugin wrote it. Kept in a global WeakMap
 * the first time a config is seen, so a second load in one session (the released and the `-dev` copy) still restores
 * Steam's value, not the first copy's (the same pattern as the pristine toast durations, steam/notification-store.ts).
 */
function pristineAlone(config: object & { displayToastAlone?: boolean }): boolean | undefined {
    const g = globalThis as { __enhancedPristineDisplayAlone?: WeakMap<object, boolean | undefined> };
    const stash = (g.__enhancedPristineDisplayAlone ??= new WeakMap());
    if (!stash.has(config)) stash.set(config, config.displayToastAlone);
    return stash.get(config);
}

type StoreLike = Parameters<typeof stackLooksStuck>[0];

/**
 * The notifications queue (./queue.ts): writes `displayToastAlone` on each type config while the `queue.enabled`
 * setting is on, and Steam's own value when it is off. Switched off (safety/features.ts `queue`) or uninstalled:
 * Steam's values come back for every type it wrote.
 *
 * Steam's desktop stack can stall when toasts are shown one at a time: it pops only while a 5 s cache is fresh, and
 * nothing refreshes it while the next toast waits (steam/toast-stack.ts). While the queue is on, the moment the stack's
 * on-screen list empties (its `SetContextRenderingToast(context, false)`) and toasts still wait, that cache is refetched
 * as Steam would; a watchdog looking once a second does the same if that signal is ever missed. Turning the queue off with
 * toasts waiting refetches it once too (the same stall, with nothing left to flip it).
 */
export function createQueueSurface(handle: NotificationStoreHandle): Surface {
    const written = new Set<number>();
    let off: (() => void) | null = null;
    let watch: ReturnType<typeof setInterval> | null = null;
    let stuckLooks = 0;
    let warnedNotFound = false;
    let uninstallIdle: (() => void) | null = null;

    const store = () => handle.store as unknown as StoreLike;

    function entries(): AloneEntry[] {
        const out: AloneEntry[] = [];
        for (const [eType, { config }] of handle.configs) out.push({ eType, pristine: pristineAlone(config as object) });
        return out;
    }

    function write(queued: boolean): void {
        for (const [eType, alone] of planAlone(entries(), queued)) {
            const config = handle.configs.get(eType)!.config as { displayToastAlone?: boolean };
            config.displayToastAlone = alone;
            written.add(eType);
        }
    }

    /** Refetch the stack's fullscreen cache if toasts wait with none on screen. */
    function unstick(): void {
        if (!stackLooksStuck(store())) return;
        const result = refreshFullscreenQuery();
        if (result === 'refetched') logger.info('Notifications queue: the toast stack was waiting on a stale cache; refreshed it.');
        else if (result === 'not-found' && !warnedNotFound) {
            warnedNotFound = true;
            logger.warn("Notifications queue: Steam's toast stack was not found; a stalled stack cannot be refreshed.");
        }
    }

    function startWatch(): void {
        uninstallIdle ??= installStackIdle(
            handle.store,
            () => {
                if (isEnabled('queue') && setting('queue.enabled')) unstick();
            },
            (error) => reportError('queue', error),
        );
        if (watch) return;
        stuckLooks = 0;
        watch = setInterval(() => {
            try {
                if (!stackLooksStuck(store())) {
                    stuckLooks = 0;
                    return;
                }
                if (++stuckLooks >= STUCK_LOOKS) {
                    stuckLooks = 0;
                    unstick();
                }
            } catch (error) {
                reportError('queue', error);
            }
        }, WATCH_MS);
    }

    function stopWatch(): void {
        if (watch) clearInterval(watch);
        watch = null;
        uninstallIdle?.();
        uninstallIdle = null;
    }

    /** Steam's own value back on every type this surface wrote. */
    function restore(): void {
        stopWatch();
        if (!written.size) return;
        for (const eType of written) {
            const entry = handle.configs.get(eType);
            if (entry) (entry.config as { displayToastAlone?: boolean }).displayToastAlone = pristineAlone(entry.config as object);
        }
        written.clear();
        try {
            unstick();
        } catch (error) {
            reportError('queue', error);
        }
    }

    function apply(): void {
        if (!isEnabled('queue')) return restore();
        try {
            const queued = setting('queue.enabled');
            write(queued);
            if (queued) startWatch();
            else {
                stopWatch();
                unstick();
            }
        } catch (error) {
            reportError('queue', error);
        }
    }

    return {
        id: 'queue',
        touches: ['typeConfig.displayToastAlone', 'desktop toast stack fullscreen query (refetch)', 'NotificationStore.SetContextRenderingToast'],
        install() {
            apply();
            off = onSettingChange((key) => {
                if (key === 'queue.enabled' || key === 'disabledFeatures') apply();
            });
            return true;
        },
        uninstall() {
            off?.();
            off = null;
            restore();
        },
    };
}
