/**
 * Game Info tiers per bucket (ADR-0035). Pure, no imports, so Node can run the
 * unit tests with type stripping.
 *
 *   local tier : library_metadata.json on disk. Applied to every shortcut that
 *                is not steam-store (none and pending included). No network.
 *   fetch tier : GetGameMetadata (IGDB). web-scraping only (ADR-0032).
 *   steam-store: owned by features/steam-store; neither tier runs.
 */
export interface GameInfoPlan {
    applyLocal: boolean;
    fetchWeb: boolean;
}

export function gameInfoPlan(bucket: string, via: string): GameInfoPlan {
    if (bucket === "steam-store") return { applyLocal: false, fetchWeb: false };
    if (via === "pending") return { applyLocal: true, fetchWeb: false };
    return { applyLocal: true, fetchWeb: bucket === "web-scraping" };
}
