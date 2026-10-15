import { cloneElement, createElement, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { showModal as millenniumShowModal, type ShowModalProps } from '@steambrew/client';
import { logger } from '../logger';
import { inBigPicture } from './ui-mode';
import { findExports } from './webpack';

/**
 * Opens a dialog with Steam's own `showModal`, the one Steam's dialogs use. Millennium's `showModal` calls the raw
 * function under it with no size, so on desktop the popout window opens at a default size far too big for a short
 * dialog; Steam's own version takes `popupWidth`/`popupHeight` (or measures the content). In Big Picture both render
 * inside the Big Picture window and the size is ignored.
 *
 * Every dialog is wrapped in Steam's `ConfigContextRoot` (module 6739, verified live 2026-10-14): from Steam build
 * 1791918634 its `ConfirmModal` reads that context and asserts ("Trying to use ConfigContext without a provider!") when
 * a plugin's dialog tree has none. The wrapper forwards the `closeModal` Steam injects into the dialog's root element.
 *
 * Resolved on the first call (a click, never a render path), once. Falls back to Millennium's `showModal`, and to no
 * wrapper when Steam has no such provider.
 */
type SteamShowModal = (modal: ReactElement, parent: EventTarget, props: ShowModalProps) => unknown;
type ConfigRoot = ComponentType<{ IN_DESKTOPUI?: boolean; IN_GAMEPADUI?: boolean; children?: ReactNode }>;

let steamShowModal: SteamShowModal | null | undefined;
let configRoot: ConfigRoot | null | undefined;

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

/** Steam's ConfigContextRoot: the provider component of the context its components assert on. */
function resolveConfigRoot(): ConfigRoot | null {
    if (configRoot !== undefined) return configRoot;
    const hits = findExports(
        (src) => src.includes('ConfigContext without a provider'),
        (v) => typeof v === 'function' && /IN_DESKTOPUI/.test(v.toString()) && /\.Provider/.test(v.toString()),
    );
    configRoot = hits.length === 1 ? (hits[0] as ConfigRoot) : null;
    if (!configRoot) logger.warn(`Steam's ConfigContextRoot resolved to ${hits.length} candidates; dialogs open without it.`);
    return configRoot;
}

/** The dialog inside Steam's config context, passing on the `closeModal` Steam gives the root element. */
function withConfig(modal: ReactElement, root: ConfigRoot): ReactElement {
    const Wrapped = ({ closeModal }: { closeModal?: () => void }) =>
        createElement(root, { IN_DESKTOPUI: !inBigPicture(), IN_GAMEPADUI: inBigPicture() }, closeModal ? cloneElement(modal, { closeModal } as object) : modal);
    // Steam reads the root element's own props (closeModal, bDisableBackgroundDismiss): the wrapper carries the dialog's.
    return createElement(Wrapped, { ...(modal.props as object) });
}

/** `parent`: the window the dialog belongs to (a dialog opened from inside a popout passes that popout's window). */
export function showDialog(modal: ReactElement, props: ShowModalProps, parent: Window = window): void {
    const steam = resolve();
    const root = resolveConfigRoot();
    const element = root ? withConfig(modal, root) : modal;
    if (steam) void steam(element, parent, props);
    else millenniumShowModal(element, parent, props);
}
