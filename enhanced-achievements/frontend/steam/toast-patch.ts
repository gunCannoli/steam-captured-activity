import { findModuleByExport } from '@steambrew/client';
import { logger } from '../logger';
import { setting } from '../settings/settings';
import { activeTheme } from '../theme/active-theme';
import { ThemedToast, setSteamToast } from '../banner/themed-toast';
import { isAchievementUnlock, type SteamNotification } from './notifications';
import { findExports } from './webpack';

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
const originals: Partial<Record<'jsx' | 'jsxs', JsxRuntime['jsx']>> = {};
const installed: Partial<Record<'jsx' | 'jsxs', unknown>> = {};
let timer: number | undefined;

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

function patch(name: 'jsx' | 'jsxs'): void {
    if (!runtime || runtime[name] === installed[name]) return;
    const original = runtime[name];
    originals[name] = original;
    const wrapped = function (this: unknown, type: unknown, props: unknown, key?: unknown) {
        if (type === dispatcher && shouldTheme(props as ToastProps)) {
            return original.call(this, ThemedToast, props, key);
        }
        return original.call(this, type, props, key);
    };
    runtime[name] = wrapped;
    installed[name] = wrapped;
}

export function initToastPatch(): boolean {
    dispatcher = resolveDispatcher();
    runtime = resolveRuntime();
    if (!dispatcher || !runtime) {
        if (!runtime) logger.warn('react/jsx-runtime not found; banner disabled.');
        return false;
    }
    setSteamToast(dispatcher);
    patch('jsx');
    patch('jsxs');
    // Steam has been seen to swap a patched runtime reference around the first
    // game launch (non-steam-games-activity, ADR-0027). Re-checking two
    // references is cheap, so a slow poll is fine.
    timer = window.setInterval(() => {
        patch('jsx');
        patch('jsxs');
    }, 5000);
    logger.info('Achievement toast patch installed.');
    return true;
}

export function disposeToastPatch(): void {
    if (timer !== undefined) window.clearInterval(timer);
    if (!runtime) return;
    for (const name of ['jsx', 'jsxs'] as const) {
        if (runtime[name] === installed[name] && originals[name]) runtime[name] = originals[name]!;
    }
}
