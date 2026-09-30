import type { Surface } from '../../kernel/surface';
import type { NotificationStoreHandle } from '../../steam/notification-store';
import { activeTheme, onThemeChange } from '../../theme/active-theme';
import { isEnabled, reportError } from '../../safety/runtime';
import { applyDuration } from './duration';

/** Writes the banner's lifetime into Steam's achievement toast duration; follows theme changes. */
export function createDurationSurface(handle: NotificationStoreHandle): Surface {
    let off: (() => void) | null = null;
    const apply = () =>
        applyDuration({
            isEnabled: () => isEnabled('duration'),
            theme: () => activeTheme()?.theme ?? null,
            pristineMs: handle.pristineDurationMs,
            write: (ms) => {
                handle.config.toastDurationMS = ms;
            },
            reportError: (err) => reportError('duration', err),
        });
    return {
        id: 'duration',
        touches: ['achievementTypeConfig.toastDurationMS'],
        install() {
            apply();
            off = onThemeChange(apply);
            return true;
        },
        uninstall() {
            off?.();
            off = null;
            handle.config.toastDurationMS = handle.pristineDurationMs;
        },
    };
}
