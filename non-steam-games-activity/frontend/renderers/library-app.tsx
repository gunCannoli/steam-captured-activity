import { logger } from '../logger';
import { gameIdFromAppId } from '../steam/gameid';
import { patchSections, setHasContent } from '../steam/sections';
import { clearSummary, publishSummary } from '../steam/summary';

/**
 * Brings the native app detail sections to a non-Steam game's page.
 *
 * There is no markup here, and no DOM surgery, on purpose. Steam already has
 * the components; it just hides them from shortcuts and never loads their data.
 * So we do exactly two things:
 *
 *   1. put the section names back into Steam's registry (steam/sections.ts)
 *   2. put events into Steam's own store            (steam/summary.ts)
 *
 * Steam renders. That is the whole renderer.
 *
 * This replaces ~800 lines of hand-built components that reproduced Steam's
 * summary markup, carousel, day grouping and hover states. Every one of those
 * was a thing that could drift from native on the next Steam update; none of
 * them can any more. See docs/steam-components.md.
 */

/** Apps whose summary we have published, so a quitting game can refresh them. */
const published = new Set<number>();

/** Set up the section patch once, at plugin load. */
export function register(): boolean {
  return patchSections();
}

/**
 * Publish this app's summary so Steam's own section can render it.
 *
 * Callers must only pass a non-Steam appid; the caller owns that check because
 * it also decides when to clear.
 */
export async function patch(appid: number): Promise<void> {
  const gameid = gameIdFromAppId(appid);

  try {
    const count = await publishSummary(appid, gameid);
    if (count > 0) published.add(appid);

    // Steam's "information is unavailable" placeholder is only worth removing
    // once we have something to show instead.
    setHasContent(appid, count > 0);
  } catch (error) {
    logger.error('Could not publish the summary for', appid, error);
  }
}

/** Re-read captures for an app (called when a game quits). */
export async function refresh(appid: number): Promise<void> {
  if (!published.has(appid)) return;
  await patch(appid);
}

/** Forget an app's summary. */
export function unpatch(appid: number): void {
  if (!published.delete(appid)) return;
  setHasContent(appid, false);
  clearSummary(appid);
}

/** Forget everything. Used when the plugin unloads. */
export function unpatchAll(): void {
  for (const appid of [...published]) unpatch(appid);
}
