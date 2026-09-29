/**
 * Per-slot artwork bookkeeping for a steam-store game (P4 H5). Pure, `import
 * type` only, so Node can run the unit tests with type stripping.
 *
 *   nothing recorded                  -> write all four slots
 *   recorded for another native app   -> clear the slots we wrote, write all four
 *   recorded for this native app      -> retry only the slots that failed at write
 *                                        time, at most once per session
 *
 * A slot the user removed in Steam is pruned from `slots` by the backend and is
 * not in `failed`, so it is never written again (the user wins).
 */
import type { ArtworkUrls, StoreApplied } from '../kernel/record';

export const ALL_SLOTS: readonly number[] = [0, 1, 2, 3];

/** Slot number -> ArtworkUrls key (SetCustomArtworkForApp image types). */
const SLOT_KEY: Record<number, keyof ArtworkUrls> = { 0: 'portrait', 1: 'hero', 2: 'logo', 3: 'wide' };

export interface ArtPlan {
    clear: number[];
    write: number[];
}

/** Lua's json.encode writes an empty list as `{}`; treat anything but an array as empty. */
export function slotList(v: unknown): number[] {
    return Array.isArray(v) ? v.filter((s): s is number => typeof s === 'number' && ALL_SLOTS.includes(s)) : [];
}

export function artworkPlan(applied: StoreApplied | null, steamAppid: number, retriedThisSession: boolean): ArtPlan {
    if (!applied) return { clear: [], write: [...ALL_SLOTS] };
    const slots = slotList(applied.slots);
    if (applied.steam_appid !== steamAppid) return { clear: slots, write: [...ALL_SLOTS] };
    if (retriedThisSession) return { clear: [], write: [] };
    return { clear: [], write: slotList(applied.failed).filter((s) => !slots.includes(s)) };
}

/** Only the URLs of the slots to write. */
export function pickUrls(urls: ArtworkUrls, slots: readonly number[]): ArtworkUrls {
    const out: ArtworkUrls = {};
    for (const slot of slots) {
        const key = SLOT_KEY[slot];
        if (key && urls[key]) out[key] = urls[key];
    }
    return out;
}

/** What to record after a write: kept + newly written slots, and the attempted slots that failed. */
export function mergeArtResult(
    applied: StoreApplied | null,
    steamAppid: number,
    plan: ArtPlan,
    written: readonly number[],
): { slots: number[]; failed: number[] } {
    const kept = applied && applied.steam_appid === steamAppid ? slotList(applied.slots) : [];
    const slots = [...new Set([...kept, ...written])].sort((a, b) => a - b);
    const failed = plan.write.filter((s) => !written.includes(s));
    return { slots, failed };
}

/**
 * SteamGridDB (M5c): a shortcut with no Steam match. Writes only the slots the backend
 * called empty (no grid file, never attempted) that also have a URL; clears nothing.
 * A slot the user set, or cleared after we filled it, is never touched.
 */
export function sgdbPlan(urls: ArtworkUrls, emptySlots: unknown): ArtPlan {
    const empty = slotList(emptySlots);
    return { clear: [], write: ALL_SLOTS.filter((s) => empty.includes(s) && !!urls[SLOT_KEY[s]!]) };
}
