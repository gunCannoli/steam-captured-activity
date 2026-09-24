/**
 * Appids whose in-memory Game Info came from the Steam Store bucket (as opposed
 * to web scraping). Shared by game-info (bucket-change handling) and
 * steam-store; a leaf module so neither imports the other.
 */
export const storeEnrichedAppIds = new Set<number>();
