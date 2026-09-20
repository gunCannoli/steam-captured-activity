import { findClassModule } from '@steambrew/client';

/**
 * Steam's own CSS-module class names, resolved at runtime.
 *
 * These names are build-hashed (`GameStatsSection` -> `_1mDAVT4sTzFRwJtlKCw2Ws`)
 * and change between client versions, so they must never be hardcoded
 * (ADR-0005). `findClassModule` locates the module by a key we expect it to
 * contain and hands back the live mapping.
 *
 * IMPORTANT: the Post-Game Summary is NOT one CSS module. It is split across
 * FOUR separate webpack modules, verified by walking Steam's own
 * `webpackChunksteamui` module cache (`req.m` factories, matched by source
 * text, then executed and inspected via `Object.keys`) and checking which
 * keys are actually exported together - not just which classes appear
 * together in one `outerHTML` capture, which does NOT imply co-membership:
 *
 *   SummaryClasses    - SummaryCarouselContainer, SummaryCarouselScrollingContainer,
 *                        GamePlaySummaryHeader, SummaryContainer,
 *                        SummaryContainerChildren, SummaryScreenshot,
 *                        EventHeaderBlock, TypeSeparator, ForcedCarouselPadding
 *   PageableClasses   - PageableContainer, HeaderPageControls, PageClickContainer,
 *                        PageLeft, PageRight, PageableCloseButton, Disabled
 *   ClipClasses       - PostGameSummaryClip, ClipThumbnail, CornerContent,
 *                        DurationText
 *   ScreenshotClasses - ClickableScreenshot, ClickableScreenshotImg,
 *                        ScreenshotShareIcon, UseWidth, UseHeight
 *
 * Resolving all of these from ONE `findClassModule('SummaryCarouselContainer')`
 * probe (as an earlier version of this file did) silently returns `undefined`
 * for every key from the other modules, and React then renders those elements
 * with NO class at all - which strips their sizing/positioning CSS entirely.
 * This is exactly how a clip tile ended up rendering at full flex-row width
 * instead of a contained thumbnail: `PostGameSummaryClip`/`ClipThumbnail`
 * resolved to `undefined`, so the tile got no `position`/size rules and grew
 * to fill its container - confirmed live: `tile.className` was just `"Panel"`.
 *
 * A fifth module, `CarouselClasses`, was added once real paging was
 * implemented (Phase 5c item 2). `BoxCarousel`/`BoxCarouselContents` were
 * initially dismissed as "no CSS of their own" from a narrower search - that
 * was wrong. They live in their own module (probe: `BoxCarousel`), a shared
 * generic carousel/animation utility module reused well beyond the Post-Game
 * Summary, which is exactly why the earlier four-module search never turned
 * it up: none of those four probes are also present in it, and it doesn't
 * carry `SummaryCarouselContainer`/`PageableContainer`/etc. either. Found by
 * reading Steam's *actual* Carousel component source (module `26271`) rather
 * than guessing from class co-occurrence again - see CarouselClasses below
 * and Pageable.tsx for the full trace.
 *
 * Lesson: after adding ANY class name to one of these maps, verify it
 * ACTUALLY RESOLVES (non-empty string on `element.className`) in the live
 * client before trusting it - do not assume two classes seen together in one
 * `outerHTML` capture live in the same module.
 *
 * Second lesson, same session: even with the maps correctly split as above,
 * a consumer can still reach into the WRONG map for a key that happens to
 * exist in both a plausible-looking place and its real one - `GamePlaySummaryHeader`
 * is only ever in `SummaryClasses`, but was once read from `PageableClasses`
 * (which has no such key). That silently rendered the header with an empty
 * class, and a naive `textContent`-based DOM query while debugging then
 * misattributed the text to its parent (`HeaderPageControls`, which DID
 * resolve), making the bug look like something else entirely. When in doubt,
 * dump the *whole* resolved module object and check names against it exactly.
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
 * The summary carousel itself, its per-day/per-tile containers, and the
 * screenshot tile. Does NOT include the clip tile or the pageable
 * header/pager - those are separate modules below.
 */
export const SummaryClasses = classModule('SummaryCarouselContainer');

/**
 * The outer `PageableContainer` wrapping the whole Post-Game Summary: the
 * header row, the pager arrows, and the dismiss ("X") button.
 */
export const PageableClasses = classModule('PageableContainer');

/**
 * The clip tile specifically: `PostGameSummaryClip`, `ClipThumbnail`,
 * `CornerContent`, `DurationText`. A screenshot tile does not need this
 * module; a clip tile needs both this AND `SummaryClasses` (for
 * `SummaryContainer`/`SummaryContainerChildren`, which wrap either tile type).
 */
export const ClipClasses = classModule('PostGameSummaryClip');

/**
 * The screenshot tile's clickable image itself: `ClickableScreenshot`,
 * `ClickableScreenshotImg`, `ScreenshotShareIcon`. A fourth, separate module -
 * `SummaryScreenshot` (the outer tile div) lives in `SummaryClasses` above,
 * but the `<img>` and its hover-share-icon classes do not.
 */
export const ScreenshotClasses = classModule('ClickableScreenshotImg');

/**
 * The real scrolling-carousel primitive's own classes: `BoxCarousel` (the
 * scrollable row, `overflow-x` + edge-mask gradient), `BoxCarouselContents`,
 * `ListElement`, `MaskRight`/`MaskRightNew` (the fade-out gradient hinting
 * more content), `OnLastPage` (removes the mask at the end). A generic,
 * widely-shared module (also used by Steam for things far outside the
 * Post-Game Summary) - resolved separately because it does not carry any of
 * the four keys the other four modules are probed by, and none of THEM carry
 * `BoxCarousel` either. See Pageable.tsx for how this pairs with
 * `PageableClasses`/`SummaryClasses` to reproduce Steam's real
 * Pageable+Carousel composition (module `4584` + `26271`, walked from the
 * live client - not reverse-engineered from markup alone).
 */
export const CarouselClasses = classModule('BoxCarousel');

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
