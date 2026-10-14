import type { ReactElement } from 'react';
import { showModal as millenniumShowModal, type ShowModalProps } from '@steambrew/client';
import { logger } from '../logger';
import { findExports } from './webpack';

/**
 * Opens a dialog with Steam's own `showModal`, the one Steam's dialogs use. Millennium's `showModal` calls the raw
 * function under it with no size, so on desktop the popout window opens at a default size far too big for a short
 * dialog; Steam's own version takes `popupWidth`/`popupHeight` (or measures the content). In Big Picture both render
 * inside the Big Picture window and the size is ignored.
 *
 * Resolved on the first call (a click, never a render path), once. Falls back to Millennium's `showModal`.
 */
type SteamShowModal = (modal: ReactElement, parent: EventTarget, props: ShowModalProps) => unknown;

let steamShowModal: SteamShowModal | null | undefined;

function resolve(): SteamShowModal | null {
    if (steamShowModal !== undefined) return steamShowModal;
    const hits = findExports(
        (src) => src.includes('RequestModalMeasure') && src.includes('bNeverPopOut'),
        // Steam 1791918634 moved `RequestModalMeasure` into a helper in the same module (verified live 2026-10-14):
        // the export itself still reads `bNeverPopOut` and `popupWidth`.
        (v) => typeof v === 'function' && v.toString().includes('bNeverPopOut') && v.toString().includes('popupWidth'),
    );
    steamShowModal = (hits[0] as SteamShowModal | undefined) ?? null;
    if (!steamShowModal) logger.warn("Steam's showModal not found; using Millennium's (desktop popups open at the default size).");
    return steamShowModal;
}

/** `parent`: the window the dialog belongs to (a dialog opened from inside a popout passes that popout's window). */
export function showDialog(modal: ReactElement, props: ShowModalProps, parent: Window = window): void {
    const steam = resolve();
    if (steam) void steam(modal, parent, props);
    else millenniumShowModal(modal, parent, props);
}
