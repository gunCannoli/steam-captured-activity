import type { Surface } from '../../kernel/surface';
import { typeName, type NotificationStoreHandle } from '../../steam/notification-store';
import { handles } from '../../steam/coexistence';
import { onSettingChange, setting } from '../../settings/settings';
import { activeTheme, onThemeChange } from '../../theme/active-theme';
import { isEnabled, reportError } from '../../safety/runtime';
import { planDurations, type DurationEntry } from './duration';

/**
 * Writes each type's toast duration into Steam's per-type config; follows theme
 * and setting changes. Switched off (safety/features.ts `duration`): writes
 * nothing, and a value already written stays until the next theme change,
 * restart or uninstall.
 */
export function createDurationSurface(handle: NotificationStoreHandle): Surface {
    /** Types this surface wrote, so uninstall restores only those (never enhanced-achievements' one). */
    const written = new Set<number>();
    let offs: (() => void)[] = [];

    function entries(): DurationEntry[] {
        const out: DurationEntry[] = [];
        for (const [eType, { pristineMs }] of handle.configs) {
            const name = typeName(eType);
            if (name) out.push({ eType, name, pristineMs });
        }
        return out;
    }

    function apply(): void {
        if (!isEnabled('duration')) return;
        try {
            const plan = planDurations(entries(), {
                themed: setting('duration.enabled') && activeTheme() !== null,
                handles: (eType) => handles(eType, 'duration'),
                themedMs: () => activeTheme()?.theme.displayTimeMs,
            });
            for (const [eType, ms] of plan) {
                handle.configs.get(eType)!.config.toastDurationMS = ms;
                written.add(eType);
            }
        } catch (error) {
            reportError('duration', error);
        }
    }

    return {
        id: 'duration',
        touches: ['typeConfig.toastDurationMS'],
        install() {
            apply();
            offs = [
                onThemeChange(apply),
                onSettingChange((key) => {
                    if (key === 'duration.enabled') apply();
                }),
            ];
            return true;
        },
        uninstall() {
            for (const off of offs) off();
            offs = [];
            for (const eType of written) {
                const entry = handle.configs.get(eType);
                if (entry) entry.config.toastDurationMS = entry.pristineMs;
            }
            written.clear();
        },
    };
}
