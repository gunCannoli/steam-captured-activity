import type { AnimationPair } from '../../theme/achievements.ts';
import { bannerTiming, themedDisplayMs } from '../../banner/timing.ts';

/**
 * The toast duration written into each type's Steam config. Pure.
 *
 * With the setting on and a theme loaded: the achievement type, when the theme has an `achievements` block, gets the
 * banner's whole lifetime (entrance + display + exit), so where Steam times the toast itself (Big Picture) the
 * banner's exit is never cut short; every other type gets the theme's `display_time_ms`, or Steam's own value when the
 * theme sets none. Otherwise Steam's own value.
 */
export interface DurationEntry {
    eType: number;
    name: string;
    pristineMs: number | undefined;
}

export function planDurations(
    entries: Iterable<DurationEntry>,
    deps: { themed: boolean; themedMs(name: string): number | null | undefined; bannerMs(entry: DurationEntry): number | undefined },
): [eType: number, ms: number | undefined][] {
    const out: [number, number | undefined][] = [];
    for (const e of entries) {
        if (!deps.themed) {
            out.push([e.eType, e.pristineMs]);
            continue;
        }
        out.push([e.eType, deps.bannerMs(e) ?? deps.themedMs(e.name) ?? e.pristineMs]);
    }
    return out;
}

/** The achievement banner's whole lifetime under its theme (entrance, display, exit). */
export function bannerDurationMs(theme: { animation: AnimationPair; displayTimeMs: number | null }, pristineMs: number | undefined): number {
    return bannerTiming(theme.animation, themedDisplayMs(theme.displayTimeMs, pristineMs)).totalMs;
}
