import { logger } from '../logger';
import type { ToastSelectors } from '../theme/theme';
import { findModules } from './webpack';

/**
 * CSS selectors for Steam's toast parts, resolved from its CSS modules.
 *
 * Verified live (docs/plans/enhanced-notifications-plan.md § 2): the same keys
 * (`StandardTemplateContainer`, `Title`, `Body`, …) exist in FOUR CSS modules
 * with different hashes, and different toast types use different modules. So
 * each key collects its hashed class from EVERY module that defines it, as
 * `:is(.a, .b, …)`. Never one probe, never a hardcoded hash (docs/plugins.md,
 * "Resolve ONE findClassModule probe per CSS module"). Scanned once at startup.
 */

/** Selector name -> CSS-module keys it covers. */
const PARTS: Record<keyof ToastSelectors, string[]> = {
    desktopPopup: ['DesktopToastPopup'],
    gamepadPopup: ['GamepadToastPopup'],
    watermark: ['DesktopToastBackground'],
    templates: ['StandardTemplateContainer', 'ShortTemplate', 'DesktopToastTemplate'],
    shortTemplate: ['ShortTemplate'],
    title: ['Title'],
    body: ['Body', 'StandardNotificationDescription'],
    subtext: ['StandardNotificationSubText'],
    logoBox: ['StandardLogoDimensions', 'ShortLogoDimensions'],
    appLogo: ['AppLogo'],
    headerIcon: ['Icon'],
};

/** A module is a toast class map if it has at least one of these distinctive keys. */
const TOAST_MODULE_KEYS = ['StandardTemplateContainer', 'DesktopToastPopup', 'GamepadToastPopup'];

/**
 * Big Picture's toast window is not reachable through the popup manager
 * (docs/plans/enhanced-notifications-toast-window-bugfix.md): it is a single
 * persistent BrowserView popup, found instead via a `GamepadToastPlaceholder`
 * div Steam renders into the Big Picture main window. Resolved in the same
 * scan/pass as the theme selectors, kept out of `PARTS`/`ToastSelectors`
 * (which feed CSS) since it locates a window, not a style target.
 */
const PLACEHOLDER_KEY = 'GamepadToastPlaceholder';

export interface ResolvedSelectors {
    theme: ToastSelectors;
    /** `:is(.hash1, .hash2, ...)` for every module with a `GamepadToastPlaceholder` class, if any resolved. */
    placeholder?: string;
}

/**
 * Generic keys (`Title`, `Body`, `Icon`, `Content`) appear in hundreds of CSS
 * modules, so they are only taken from modules that are toast class maps.
 */
export function resolveToastSelectors(): ResolvedSelectors {
    const modules = findModules(
        (src) => TOAST_MODULE_KEYS.some((k) => src.includes(k)) || src.includes(PLACEHOLDER_KEY),
        (mod) => TOAST_MODULE_KEYS.some((k) => typeof mod[k] === 'string') || typeof mod[PLACEHOLDER_KEY] === 'string',
    );

    const classesByKey = new Map<string, Set<string>>();
    for (const mod of modules) {
        for (const keys of [...Object.values(PARTS), [PLACEHOLDER_KEY]]) {
            for (const key of keys) {
                const value = mod[key];
                // Values look like "_30fVm4Rsel-4nUKEiPJgz9 StandardTemplateContainer": the first token is the hash.
                const hashed = typeof value === 'string' ? value.split(/\s+/)[0] : undefined;
                if (!hashed) continue;
                if (!classesByKey.has(key)) classesByKey.set(key, new Set());
                classesByKey.get(key)!.add(hashed);
            }
        }
    }

    const selectors: ToastSelectors = {};
    const missing: string[] = [];
    for (const [part, keys] of Object.entries(PARTS) as [keyof ToastSelectors, string[]][]) {
        const classes = keys.flatMap((k) => [...(classesByKey.get(k) ?? [])]);
        if (!classes.length) {
            missing.push(part);
            continue;
        }
        selectors[part] = `:is(${classes.map((c) => `.${CSS.escape(c)}`).join(', ')})`;
    }

    const placeholderClasses = [...(classesByKey.get(PLACEHOLDER_KEY) ?? [])];
    const placeholder = placeholderClasses.length
        ? `:is(${placeholderClasses.map((c) => `.${CSS.escape(c)}`).join(', ')})`
        : undefined;
    if (!placeholder) logger.warn('Big Picture toast window unreachable; Big Picture toasts stay stock.');

    logger.info(`Toast class maps: ${modules.length} modules${missing.length ? `; unresolved (left stock): ${missing.join(', ')}` : ''}.`);
    return { theme: selectors, placeholder };
}
