import { findModuleByExport } from '@steambrew/client';
import { logger } from '../../logger';
import { achievementTheme } from '../../theme/active-theme';
import { ThemedToast, setSteamToast } from './themed-toast';
import type { SteamNotification } from '../../kernel/notification';
import { isAchievementUnlock } from '../../steam/notification-store';
import { findExports } from '../../steam/webpack';
import { keepJsxPatched, type JsxHookDiagnostics } from '../../steam/jsx-hook';
import { isEnabled, reportError } from '../../safety/runtime';

/**
 * Swaps Steam's notification-toast dispatcher for our themed toast, for
 * unlocked achievements only.
 *
 * Verified live: the achievement renderer is not exported, but its dispatcher
 * is. That is the exported function that switches on a group's eType, and it
 * is created as `jsx(dispatcher, { location, group, onDismiss })` inside
 * Steam's toast container. Every toast window (desktop popup, Big Picture, in-game
 * overlay) is a portal from SharedJSContext, and `react/jsx-runtime` is one
 * shared module (ADR-0027), so one patch covers them all.
 *
 * Guardrail 2: `jsx` runs for every element in the client. The added work is
 * one identity compare (`type === dispatcher`); everything else happens only
 * for that one component.
 */

interface JsxRuntime {
    jsx(type: unknown, props: unknown, key?: unknown): unknown;
    jsxs(type: unknown, props: unknown, key?: unknown): unknown;
}

interface ToastProps {
    group?: { eType?: number; notifications?: SteamNotification[] };
}

let runtime: JsxRuntime | null = null;
let dispatcher: unknown = null;
let hook: ReturnType<typeof keepJsxPatched> | null = null;

function resolveDispatcher(): unknown {
    const hits = findExports(
        (src) => src.includes('global_achieved_pct()') && src.includes('Missing activate function'),
        (value) => {
            if (typeof value !== 'function') return false;
            const src = Function.prototype.toString.call(value);
            return src.includes('group') && /switch\(\w\)\{case/.test(src);
        },
    );
    if (hits.length !== 1) {
        logger.warn(`Toast dispatcher resolved to ${hits.length} candidates (expected 1); banner disabled.`);
        return null;
    }
    return hits[0];
}

function resolveRuntime(): JsxRuntime | null {
    const found = findModuleByExport(
        (moduleExport: unknown, exportName?: unknown) =>
            (exportName === 'jsx' || exportName === 'jsxs') && typeof moduleExport === 'function',
    ) as JsxRuntime | undefined;
    return found && typeof found.jsx === 'function' && typeof found.jsxs === 'function' ? found : null;
}

/** An unlock, with the theme's `achievements` block loaded and "Themed style" on (off: Steam's look for every toast). */
function shouldTheme(props: ToastProps | undefined): boolean {
    const n = props?.group?.notifications?.[0];
    return isAchievementUnlock(n) && achievementTheme() !== null;
}

/**
 * True once the banner patch is installed (read by index.tsx's `bannerDraws`, which the style surface asks on every
 * toast). O(1): the patch heals itself within a microtask of being dropped (steam/jsx-hook.ts), so "installed" means
 * "kept installed". Walking the chain here could call the jsx runtime with a sentinel on every toast.
 */
export function toastPatchInstalled(): boolean {
    return hook !== null;
}

/** Chain health, for tests (window.PLUGIN_LIST[...].jsxDiagnostics()). */
export function jsxDiagnostics(): JsxHookDiagnostics[] {
    return hook?.diagnostics() ?? [];
}

export function initToastPatch(): boolean {
    dispatcher = resolveDispatcher();
    runtime = resolveRuntime();
    if (!dispatcher || !runtime) {
        if (!runtime) logger.warn('react/jsx-runtime not found; banner disabled.');
        return false;
    }
    setSteamToast(dispatcher);
    // Self-healing SDK patch shared safely with other plugins (steam/jsx-hook.ts):
    // it re-installs only when it is no longer anywhere in the chain.
    hook = keepJsxPatched(runtime, {
        label: 'enhanced-notifications',
        replaceType: (type, props) => {
            if (type !== dispatcher) return undefined; // every other element: one compare
            // Fail-open (migration plan § E0a): any error leaves Steam's own toast.
            try {
                return isEnabled('banner') && shouldTheme(props as ToastProps) ? ThemedToast : undefined;
            } catch (error) {
                reportError('banner', error);
                return undefined;
            }
        },
    });
    logger.info('Achievement toast patch installed.');
    return true;
}

export function disposeToastPatch(): void {
    hook?.dispose();
    hook = null;
}
