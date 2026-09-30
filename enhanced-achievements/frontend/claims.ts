import { achievementEType } from './steam/notification-store';
import { toastPatchInstalled } from './steam/toast-patch';
import { activeTheme } from './theme/active-theme';
import { isEnabled } from './safety/runtime';

/**
 * What this plugin currently handles for achievement unlocks, published on
 * window.PLUGIN_LIST so enhanced-notifications (a separate plugin that styles
 * every toast type) can leave those features to us. No import either way:
 * plugins stay independent (docs/plugins.md § Layout).
 *
 * Ownership rule: while our hooks are live, achievement toasts are ours, and
 * what we do with them is the user's choice in *this* plugin. "Steam default"
 * (no theme), a theme that failed to load, a theme without a sound or without
 * `display_time_ms` all mean "keep Steam's own", not "let another plugin
 * style it". Before this rule, "Steam default" returned false for everything
 * and enhanced-notifications painted its own border and glow on the toast.
 *
 * Handed back: the banner when a theme is loaded but our toast patch is not
 * live, and any feature whose kill switch is off (user setting, error budget;
 * safety/features.ts): we are not doing it, so the other plugin may.
 *
 * O(1): reads in-memory state only.
 */
export function claims(feature: 'banner' | 'sound' | 'duration'): boolean {
    if (achievementEType() === null) return false; // our hooks are not installed
    switch (feature) {
        case 'banner':
            return activeTheme() === null || (toastPatchInstalled() && isEnabled('banner'));
        case 'sound':
        case 'duration':
            return isEnabled(feature);
        default:
            return false;
    }
}
