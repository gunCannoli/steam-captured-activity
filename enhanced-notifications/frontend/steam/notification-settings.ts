import { logger } from '../logger';
import { findExports } from './webpack';

/**
 * Read-only, one-shot detection of Steam's own "toast notifications" client
 * setting, so the settings panel can warn when styling, sounds and display
 * time will never show because the user turned Steam's toasts off entirely.
 *
 * This plugin never adds a hook to work around toasts being disabled
 * (docs/plans/phase7-and-alpha-plan.md, Q5: declined). If toasts are off,
 * Steam's own `ProcessNotification` returns early and no toast (styled or
 * not) is ever shown — that is expected, not a bug.
 *
 * Resolved by signature (never a module id), once at startup: the singleton
 * client-settings store, found as the export (from the module that defines
 * `MergeNotificationPreferences`) whose `.clientSettings` object carries the
 * `disable_all_toasts` key. Read on demand at render time — a plain property
 * read, no polling.
 */

interface ClientSettingsStore {
    clientSettings: Record<string, unknown>;
}

let store: ClientSettingsStore | null | undefined;

export function initNotificationSettingsDetection(): boolean {
    if (store !== undefined) return store !== null;
    const hits = findExports(
        (src) => src.includes('MergeNotificationPreferences'),
        (v) => {
            const s = v as ClientSettingsStore;
            return !!s && typeof s === 'object' && typeof s.clientSettings === 'object' && s.clientSettings !== null && 'disable_all_toasts' in s.clientSettings;
        },
    );
    store = hits.length === 1 ? (hits[0] as ClientSettingsStore) : null;
    if (!store) logger.warn('Could not resolve Steam client notification settings; toast-disabled detection unavailable.');
    return store !== null;
}

/** `true` = Steam's toasts are on, `false` = disabled globally, `null` = undetectable on this build. */
export function toastsEnabled(): boolean | null {
    if (store === undefined) initNotificationSettingsDetection();
    if (!store) return null;
    const v = store.clientSettings.disable_all_toasts;
    return typeof v === 'boolean' ? !v : null;
}
