import { logger } from '../logger';

/**
 * Is Steam in Big Picture? Steam's own UI mode (`SteamClient.UI.GetUIMode()`: 7 desktop, 4 Big Picture, verified live
 * 2026-10-14), read once at start-up and kept by `RegisterForUIModeChanged`, so `inBigPicture()` is a variable read
 * (guardrail 2: the sound and banner ask per toast). Before the first answer, and where Steam has no such API: desktop.
 */
const BIG_PICTURE = 4;

let mode: number | undefined;
const listeners = new Set<(bigPicture: boolean) => void>();

export function inBigPicture(): boolean {
    return mode === BIG_PICTURE;
}

/** Called after Steam switches between desktop and Big Picture (not for other mode changes). */
export function onBigPictureChange(listener: (bigPicture: boolean) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function set(next: unknown): void {
    if (typeof next !== 'number') return;
    const was = inBigPicture();
    mode = next;
    if (inBigPicture() === was) return;
    for (const listener of listeners) {
        try {
            listener(inBigPicture());
        } catch (error) {
            logger.warn('A Big Picture mode listener threw.', error);
        }
    }
}

/** Once, at start-up. Fail-open: without the API every toast gets the desktop look. */
export async function initUiMode(): Promise<void> {
    const ui = (Reflect.get(globalThis, 'SteamClient') as { UI?: { GetUIMode?: () => Promise<number>; RegisterForUIModeChanged?: (cb: (m: number) => void) => unknown } } | undefined)?.UI;
    try {
        ui?.RegisterForUIModeChanged?.((m) => set(m));
        set(await ui?.GetUIMode?.());
    } catch (error) {
        logger.warn("Steam's UI mode is unavailable; every toast gets the desktop look.", error);
    }
}
