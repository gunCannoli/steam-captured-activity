import type { SteamNotification } from '../kernel/notification.ts';

/**
 * The one wrapper around `NotificationStore.prototype.PlayNotificationSound`
 * (migration plan § 4.5, D3). Infrastructure, not a feature: it decides
 * nothing. It tells observers that Steam showed a toast and hands the sound
 * decision to the one sound handler (surfaces/sound). Pure: it mutates only
 * the `proto` it is given, so `npm test` drives it with fakes.
 */

export interface SoundCall {
    readonly n: SteamNotification;
    /** Steam's own PlayNotificationSound on the store: its chime, if Steam's settings want one. */
    playSteam(): void;
    /** Steam's own PlayNotificationSound with its sound choice intercepted: returns whether Steam wanted a sound. Plays nothing. */
    askSteam(): boolean;
}

/** Decides the sound of one shown toast. Calls playSteam() or askSteam() at most once, now or later. */
export type SoundHandler = (call: SoundCall) => void;

export interface NotificationHook {
    /** Observers of every toast Steam shows; run first, in order, each isolated; must be O(1). */
    onShown(listener: (n: SteamNotification) => void): () => void;
    /** The one sound handler; null restores Steam's sound. */
    setSoundHandler(handler: SoundHandler | null): void;
    /** Restores Steam's PlayNotificationSound if it is still ours. Idempotent. */
    uninstall(): void;
}

export function installNotificationHook(
    proto: { PlayNotificationSound(this: unknown, n: SteamNotification): void; ChooseSound(this: unknown, config: unknown, n: SteamNotification): unknown },
    owner: object,
    deps: { reportError(id: 'sound', err: unknown): void; warn(message: string, err: unknown): void },
): NotificationHook {
    const original = proto.PlayNotificationSound;
    const originalChoose = proto.ChooseSound;
    const listeners = new Set<(n: SteamNotification) => void>();
    let handler: SoundHandler | null = null;

    const wrapper = function (this: unknown, n: SteamNotification): void {
        // Only Steam's own calls (on the store) are toasts; stand-in calls that
        // read a type's config (ours, enhanced-notifications') pass through.
        if (this !== owner) return original.call(this, n);
        for (const listener of [...listeners]) {
            try {
                listener(n);
            } catch (err) {
                deps.warn('A notification listener threw; the toast is unaffected.', err);
            }
        }
        const current = handler;
        if (!current) return original.call(this, n);

        const self = this as { ChooseSound?: unknown };
        let used = false;
        const call: SoundCall = {
            n,
            playSteam() {
                if (used) return;
                used = true;
                original.call(self, n);
            },
            askSteam() {
                if (used) return false;
                used = true;
                // Let Steam decide whether a sound is wanted (its mute setting),
                // but take the decision instead of playing its chime.
                let wanted = false;
                self.ChooseSound = function (this: unknown, config: unknown, notification: SteamNotification) {
                    wanted = !!originalChoose.call(this, config, notification);
                    return null;
                };
                try {
                    original.call(self, n);
                } finally {
                    delete self.ChooseSound;
                }
                return wanted;
            },
        };
        try {
            current(call);
        } catch (err) {
            deps.reportError('sound', err); // this toast gets Steam's chime
            if (!used) {
                used = true;
                original.call(self, n);
            }
        }
    };
    proto.PlayNotificationSound = wrapper;

    return {
        onShown(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        setSoundHandler(next) {
            handler = next;
        },
        uninstall() {
            if (proto.PlayNotificationSound === wrapper) proto.PlayNotificationSound = original;
        },
    };
}
