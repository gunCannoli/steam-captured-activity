import { toastPatchInstalled } from './steam/toast-patch';
import { activeTheme } from './theme/active-theme';

/**
 * What this plugin currently handles for achievement unlocks, published on
 * window.PLUGIN_LIST so enhanced-notifications (a separate plugin that styles
 * every toast type) can leave those features to us. No import either way:
 * plugins stay independent (docs/plugins.md § Layout).
 *
 * O(1): reads in-memory settings and the loaded theme only.
 */
export function claims(feature: 'banner' | 'sound' | 'duration'): boolean {
    const theme = activeTheme();
    if (!theme) return false;
    switch (feature) {
        case 'banner':
            return toastPatchInstalled();
        case 'sound':
            return theme.sounds.size > 0;
        case 'duration':
            return theme.theme.displayTimeMs !== null;
        default:
            return false;
    }
}
