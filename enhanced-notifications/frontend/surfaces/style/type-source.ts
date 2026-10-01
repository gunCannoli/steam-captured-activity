/**
 * Which Steam signal sets the type of the toast on screen, for Big Picture's one toast window and for a desktop popup
 * whose own type is not known yet (./injector.ts). Pure, so `npm test` checks it.
 *
 * - `pop` (the default): `NotificationStore.PopNextToastNotification` handed this toast to a toast view
 *   (steam/toast-pop.ts). Steam calls it before the toast renders, so the type is in place for its first frame.
 * - `shown`: the shared hook's `onShown`, from Steam's effect after the toast is committed (a frame late). The
 *   fallback when Steam has no `PopNextToastNotification`.
 * - `arrival`: NotificationStore's current toast, which changes when a toast ARRIVES, also while another one is on
 *   screen: a queued toast restyled the one showing, and Steam's own 300 px slide-in restarted (verified live
 *   2026-10-01, docs/plans/enhanced-notifications-bigpicture-toast-fix-plan.md). Kept only as a debug switch that
 *   reproduces that; like the old code, it also takes `shown`.
 * - `manual`: neither; a probe sets the type (./bp-debug.ts `debugBigPictureType`).
 */
export type TypeSource = 'pop' | 'shown' | 'arrival' | 'manual';

/** A signal is a source, or `refresh` (a theme or setting change re-applying the current type). */
export type TypeSignal = TypeSource | 'refresh';

export const TYPE_SOURCES: readonly TypeSource[] = ['pop', 'shown', 'arrival', 'manual'];

/** Whether `signal` may set the current toast type under `source`. `popAvailable` false: `pop` falls back to `shown`. */
export function takesSignal(source: TypeSource, signal: TypeSignal, popAvailable: boolean): boolean {
    if (signal === 'refresh') return true;
    const effective: TypeSource = source === 'pop' && !popAvailable ? 'shown' : source;
    if (effective === 'arrival') return signal === 'arrival' || signal === 'shown';
    return signal === effective;
}
