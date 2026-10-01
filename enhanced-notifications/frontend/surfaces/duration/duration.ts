/**
 * The toast duration written into each type's Steam config. Pure.
 *
 * With the setting on and a theme loaded, a type's `display_time_ms` (or Steam's
 * own value when the theme sets none); otherwise Steam's own value. A type
 * handed to enhanced-achievements is skipped: its value is that plugin's.
 */
export interface DurationEntry {
    eType: number;
    name: string;
    pristineMs: number | undefined;
}

export function planDurations(
    entries: Iterable<DurationEntry>,
    deps: { themed: boolean; handles(eType: number): boolean; themedMs(name: string): number | null | undefined },
): [eType: number, ms: number | undefined][] {
    const out: [number, number | undefined][] = [];
    for (const e of entries) {
        if (!deps.handles(e.eType)) continue;
        const themed = deps.themed ? deps.themedMs(e.name) : null;
        out.push([e.eType, themed ?? e.pristineMs]);
    }
    return out;
}
