import { findClassModule } from '@steambrew/client';

/**
 * Steam's own CSS-module class names, resolved at runtime.
 *
 * These names are build-hashed (`GameStatsSection` -> `_1mDAVT4sTzFRwJtlKCw2Ws`)
 * and change between client versions, so they must never be hardcoded
 * (ADR-0005). `findClassModule` locates the module by a key we expect it to
 * contain and hands back the live mapping.
 *
 * The key names below were read out of Steam's own bundle
 * (`steamui/chunk~2dcc5aaf7.js`) so the shapes are real, not guessed. Anything
 * may still be missing on a future client build, so every lookup is optional
 * and callers fall back rather than crash.
 */

type ClassMap = Record<string, string>;

function classModule(probe: string): ClassMap {
  try {
    const found = findClassModule((m) => (m as ClassMap)[probe] !== undefined);
    return (found as ClassMap) ?? {};
  } catch {
    return {};
  }
}

/**
 * The play bar at the top of an app page: PLAY, CLOUD STATUS, LAST PLAYED,
 * PLAY TIME, ACHIEVEMENTS. `GameStatsSection` is the row our stats join.
 */
export const PlayBarClasses = classModule('GameStatsSection');

/**
 * Steam's own activity feed, grouped by day. `AppActivityDay` wraps one date,
 * `AppActivityDate` is its heading, `Event` is a single entry.
 */
export const ActivityClasses = classModule('AppActivityDay');

/**
 * Steam's post-game summary: a horizontal carousel of screenshots, clips and
 * achievements with navigation arrows. Reusing these gives us its hover
 * animation and clip styling for free.
 */
export const SummaryClasses = classModule('SummaryCarouselContainer');

/** True when a module resolved; lets callers degrade instead of rendering unstyled. */
export function hasClasses(map: ClassMap): boolean {
  return Object.keys(map).length > 0;
}

/**
 * Join class names, dropping any that failed to resolve, so a missing lookup
 * degrades to plain-but-present markup rather than the literal "undefined".
 */
export function cx(...names: (string | undefined | false)[]): string {
  return names.filter(Boolean).join(' ');
}
