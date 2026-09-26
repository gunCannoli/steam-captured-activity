/**
 * Game Info tiers per bucket (ADR-0035, amended by ADR-0036). Pure, no
 * imports, so Node can run the unit tests with type stripping.
 *
 *   local tier : library_metadata.json on disk. No network.
 *   fetch tier : GetGameMetadata (IGDB). web-scraping, and the steam-store
 *                fallback when the game has no Steam match (ADR-0036).
 *   steam-store: with a Steam match, features/steam-store owns Game Info and
 *                neither tier runs. Before the store has answered, local only.
 *
 * `storeMatched`: true = store data applied, false = no Steam match,
 * undefined = not known yet (or not a steam-store game).
 */
export interface GameInfoPlan {
    applyLocal: boolean;
    fetchWeb: boolean;
}

export function gameInfoPlan(bucket: string, via: string, storeMatched?: boolean): GameInfoPlan {
    if (via === "pending") return { applyLocal: true, fetchWeb: false };
    if (bucket === "steam-store") {
        if (storeMatched === true) return { applyLocal: false, fetchWeb: false };
        return { applyLocal: true, fetchWeb: storeMatched === false };
    }
    return { applyLocal: true, fetchWeb: bucket === "web-scraping" };
}
