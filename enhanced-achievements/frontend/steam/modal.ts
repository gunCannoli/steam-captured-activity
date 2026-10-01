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
        (v) => typeof v === 'function' && v.toString().includes('RequestModalMeasure') && v.toString().includes('bNeverPopOut'),
    );
    steamShowModal = (hits[0] as SteamShowModal | undefined) ?? null;
    if (!steamShowModal) logger.warn("Steam's showModal not found; using Millennium's (desktop popups open at the default size).");
    return steamShowModal;
}

export function showDialog(modal: ReactElement, props: ShowModalProps): void {
    const steam = resolve();
    if (steam) void steam(modal, window, props);
    else millenniumShowModal(modal, window, props);
}
