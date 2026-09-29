import { logger } from "../logger";
import { clearActivity, publishActivity } from "../steam/activity";
import { gameIdFromAppId } from "../steam/gameid";
import { clearSummary, publishSummary } from "../steam/summary";

/**
 * Brings the native app detail sections to a non-Steam game's page.
 *
 * There is no markup here, and no DOM surgery, on purpose. Steam already has
 * the components; it just hides them from shortcuts and never loads their data.
 * So we do exactly two things:
 *
 *   1. put the section names back into Steam's registry (surfaces/sections)
 *   2. put events into Steam's own stores           (steam/summary.ts & steam/activity.ts)
 *
 * Steam renders. That is the whole renderer.
 *
 * This replaces ~800 lines of hand-built components that reproduced Steam's
 * summary markup, carousel, day grouping and hover states. Every one of those
 * was a thing that could drift from native on the next Steam update; none of
 * them can any more. See docs/steam-components.md.
 */

/** Apps whose summary or activity we have published, so a quitting game can refresh them. */
const published = new Set<number>();

/** Tells the sections surface whether an app has content (wired in index.tsx, plan § 7.0 D3). */
let setHasContent: (appid: number, hasContent: boolean) => void = () => {};

export function setContentListener(fn: (appid: number, hasContent: boolean) => void): void {
    setHasContent = fn;
}

/**
 * Publish this app's summary and activity feed so Steam's own sections can render them.
 *
 * Callers must only pass a non-Steam appid; the caller owns that check because
 * it also decides when to clear.
 */
export async function patch(appid: number): Promise<void> {
    const gameid = gameIdFromAppId(appid);

    try {
        const [summaryCount, activityCount] = await Promise.all([
            publishSummary(appid, gameid),
            publishActivity(appid, gameid),
        ]);
        const totalCount = summaryCount + activityCount;
        if (totalCount > 0) published.add(appid);

        // Steam's "information is unavailable" placeholder is only worth removing
        // once we have something to show instead.
        setHasContent(appid, totalCount > 0);
    } catch (error) {
        logger.error("Could not publish summary or activity for", appid, error);
    }
}

/** Re-read captures for an app (called when a game quits). */
export async function refresh(appid: number): Promise<void> {
    if (!published.has(appid)) return;
    await patch(appid);
}

/** Forget an app's summary and activity feed. */
export function unpatch(appid: number): void {
    if (!published.delete(appid)) return;
    setHasContent(appid, false);
    clearSummary(appid);
    clearActivity(appid);
}

