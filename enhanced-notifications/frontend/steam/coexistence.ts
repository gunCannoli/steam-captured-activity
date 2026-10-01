import { typeName } from './notification-store';

/**
 * enhanced-achievements coexistence (read-only). It replaces achievement toasts
 * entirely; when it is loaded and claims a feature, achievement toasts are left
 * to it. It publishes `claims(feature)` on window.PLUGIN_LIST (Millennium
 * exposes plugin exports there). No import: plugins stay independent
 * (docs/plugins.md § Layout). Its `claims()` is O(1), so this is safe per toast.
 */

export type ClaimedFeature = 'banner' | 'sound' | 'duration';

export function achievementsClaims(feature: ClaimedFeature): boolean {
    const list = Reflect.get(globalThis, 'PLUGIN_LIST') as Record<string, { claims?: (f: ClaimedFeature) => boolean }> | undefined;
    const ea = list?.['enhanced-achievements-dev'] ?? list?.['enhanced-achievements'];
    try {
        return typeof ea?.claims === 'function' && ea.claims(feature) === true;
    } catch {
        return false;
    }
}

/** Should this plugin handle `feature` for this notification type? O(1). */
export function handles(eType: number, feature: ClaimedFeature): boolean {
    return typeName(eType) !== 'Achievement' || !achievementsClaims(feature);
}
