import { achievementEType } from './steam/notifications';
import { toastPatchInstalled } from './steam/toast-patch';
import { activeTheme } from './theme/active-theme';

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
 * The one case handed back is the banner when a theme is loaded but our
 * toast patch is not live: we could not draw it, so the other plugin may.
 *
 * O(1): reads in-memory state only.
 */
export function claims(feature: 'banner' | 'sound' | 'duration'): boolean {
    if (achievementEType() === null) return false; // our hooks are not installed
    switch (feature) {
        case 'banner':
            return activeTheme() === null || toastPatchInstalled();
        case 'sound':
        case 'duration':
            return true;
        default:
            return false;
    }
}
