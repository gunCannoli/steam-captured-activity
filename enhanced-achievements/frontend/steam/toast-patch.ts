import { findModuleByExport } from '@steambrew/client';
import { logger } from '../logger';
import { setting } from '../settings/settings';
import { activeTheme } from '../theme/active-theme';
import { ThemedToast, setSteamToast } from '../banner/themed-toast';
import { isAchievementUnlock, type SteamNotification } from './notifications';
import { findExports } from './webpack';
import { keepJsxPatched, type JsxHookDiagnostics } from './jsx-hook';

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

function shouldTheme(props: ToastProps | undefined): boolean {
    const n = props?.group?.notifications?.[0];
    return isAchievementUnlock(n) && setting('banner.enabled') && activeTheme() !== null;
}

/** True once the banner patch is live (used by claims() for enhanced-notifications). */
export function toastPatchInstalled(): boolean {
    return !!hook && hook.diagnostics().every((d) => d.live);
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
        label: 'enhanced-achievements',
        replaceType: (type, props) => (type === dispatcher && shouldTheme(props as ToastProps) ? ThemedToast : undefined),
    });
    logger.info('Achievement toast patch installed.');
    return true;
}

export function disposeToastPatch(): void {
    hook?.dispose();
    hook = null;
}
