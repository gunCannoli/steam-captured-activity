// Steam's toasts and their sounds, held back while muted (ADR-0065). The only code here that touches Steam.
//
// Two gates in Steam's NotificationStore (module 60917), both plain prototype methods, so an own property on the store
// instance wraps them and other plugins' wraps compose (we always call the original when not muted):
// - `BShouldSupressToasts()`: Steam's own "hold every toast" check (it answers true while a VR headset sleeps).
//   `ProcessNotification` asks it for each client notification before queueing the toast or choosing its sound, so
//   true drops both. The notification still reaches Steam's tray (the bell list): that happens earlier.
// - `SendPendingServerToasts()`: server notifications (gifts, invites, comments) wait 3 s in `m_rgPendingToasts`, then
//   this queues them without asking the gate above. Muted, the batch is dropped; the tray already has them.
// Toasts already on screen or queued when the mute starts still show.

interface NotificationStoreLike {
    BShouldSupressToasts?: (...args: unknown[]) => boolean;
    SendPendingServerToasts?: (...args: unknown[]) => unknown;
    m_rgPendingToasts?: unknown[];
}

let muted = false;
let installed = false;

function install(): boolean {
    if (installed) return true;
    const store = (window as any).NotificationStore as NotificationStoreLike | undefined;
    if (!store || typeof store.BShouldSupressToasts !== "function" || typeof store.SendPendingServerToasts !== "function") {
        console.warn("[steam-cartridges-third-party] NotificationStore gates not found; Xbox notification mute unavailable.");
        return false;
    }
    const suppress = store.BShouldSupressToasts;
    const sendPending = store.SendPendingServerToasts;
    store.BShouldSupressToasts = function (this: NotificationStoreLike, ...args: unknown[]) {
        return muted || suppress.apply(this, args);
    };
    store.SendPendingServerToasts = function (this: NotificationStoreLike, ...args: unknown[]) {
        if (muted) {
            this.m_rgPendingToasts = [];
            return undefined;
        }
        return sendPending.apply(this, args);
    };
    installed = true;
    return true;
}

/** Turns the mute on or off. Installs the wraps on first use; false when Steam has no such gates (nothing muted). */
export function setToastsMuted(on: boolean): boolean {
    if (on && !install()) return false;
    if (muted !== on) console.log(`[steam-cartridges-third-party] Steam notifications ${on ? "muted" : "unmuted"} (Xbox game).`);
    muted = on;
    return true;
}
