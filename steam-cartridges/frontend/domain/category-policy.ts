/**
 * Which Steam store categories a shortcut may carry (parity plan Part F,
 * ADR-0038). A shortcut is not a Steam licence, so it shows only what is true
 * of the game itself: who can play it and which controllers it supports.
 * Steam services (Achievements, Cloud, Trading Cards, Workshop, Remote Play,
 * Family Sharing, Steam Input API, ...) belong to the Steam copy and are never
 * written. Pure, `import type` only, so Node can run the unit tests.
 *
 * Ids verified live 2026-09-25 against the badge table of Steam's Game Info
 * (FeaturesList) and StoreItemCache's three category groups
 * (docs/steam-components.md, "Store categories and feature badges").
 */
import type { GameCategories } from '../kernel/record';
import { MANAGED_CATEGORY_IDS, PORTABLE_CATEGORY_IDS, STEAM_ONLY_CATEGORY_IDS } from '../kernel/record.ts';

export { MANAGED_CATEGORY_IDS, PORTABLE_CATEGORY_IDS, STEAM_ONLY_CATEGORY_IDS };

const ALLOWED = new Set<number>(PORTABLE_CATEGORY_IDS);

/** Keep only allowed ids; numbers only, deduplicated, ascending. */
export function portableCategoryIds(ids: Iterable<unknown>): number[] {
    const out = new Set<number>();
    for (const id of ids) {
        if (typeof id === 'number' && ALLOWED.has(id)) out.add(id);
    }
    return [...out].sort((a, b) => a - b);
}

/**
 * What decides the controller badge of a shortcut without Steam Store data
 * (ADR-0038 addendum). `inferred` comes from the shortcut's emulator
 * (backend emulator_controllers.lua): true, false, or undefined when unknown.
 * `defaultFull` is the setting "Default to full controller support".
 */
export interface ControllerContext {
    inferred?: boolean;
    defaultFull?: boolean;
    override?: 'full' | 'partial' | 'none' | 'auto';
}

/** Full Controller Support (28) from override first, then emulator, then user's default; else none. */
export function inferredControllerIds(ctx: ControllerContext = {}): number[] {
    if (ctx.override === 'full') return [28];
    if (ctx.override === 'partial') return [18];
    if (ctx.override === 'none') return [];
    if (ctx.inferred === true) return [28];
    if (ctx.inferred === false) return [];
    return ctx.defaultFull === true ? [28] : [];
}

/**
 * The category ids to write for one game. Steam's own ids win when the Steam
 * Store supplied them (exact); otherwise the flags of local / web metadata are
 * mapped. `achievements` and `remote_play_together` are Steam services and are
 * never mapped (ADR-0038).
 *
 * Controller precedence (ADR-0038 addendum): Steam Store data > emulator
 * inference > the default setting > no badge. Steam Store data is
 * `store_category_ids` or the explicit flags of a `source: 'steam-store'`
 * record. Local and IGDB records carry no controller data (web_igdb.lua and
 * the fallback record always write `full_controller = true`), so their
 * controller flags are ignored.
 */
export function badgeCategoryIds(
    meta: { categories?: GameCategories; store_category_ids?: unknown; source?: string },
    controller: ControllerContext = {},
): number[] {
    if (Array.isArray(meta.store_category_ids)) return portableCategoryIds(meta.store_category_ids);
    const c = meta.categories ?? {};
    const ids: number[] = [];
    if (c.single_player) ids.push(2);
    if (c.multiplayer) ids.push(1);
    if (c.coop) ids.push(9);
    if (c.split_screen) {
        ids.push(24);
        if (c.coop) ids.push(39);
    }
    if (meta.source === 'steam-store') {
        if (c.full_controller === true) ids.push(28);
        if (c.partial_controller === true) ids.push(18);
    } else {
        ids.push(...inferredControllerIds(controller));
    }
    return portableCategoryIds(ids);
}
