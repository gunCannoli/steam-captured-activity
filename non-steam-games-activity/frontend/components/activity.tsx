import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Activity, TimelineEntry } from '../rpc';
import { loadScreenshotIndex, type LocalScreenshot } from '../steam-media';
import { ActivityClasses as A, PageableClasses as P, SummaryClasses as S, cx } from './classes';
import { ItemCarousel, type ItemCarouselHandle } from './carousel';
import { MediaCard } from './media-card';

/**
 * The page body: a session-scoped post-game summary, then activity by day.
 *
 * This mirrors Steam's own two-scope layout - the summary covers the most
 * recent play session, while the feed below covers all history grouped by
 * calendar date. Both come from one `GetActivity` payload.
 *
 * The summary clones Steam's real `PageableContainer` tree (see
 * knowledgebase.md "The real Post-Game Summary DOM, verbatim") rather than a
 * hand-built section+carousel. The header, pager and dismiss button live in
 * one `HeaderPageControls` row above the carousel; inside the carousel, EACH
 * TILE IS ITS OWN `SummaryContainer` (verified live - a day with a clip and a
 * screenshot renders as two sibling containers, not one container holding
 * both), joined by empty `TypeSeparator` spacer divs. Only the first tile of a
 * day carries the visible "Today"/date heading. All classes below are Steam's
 * own, resolved at runtime; nothing here introduces a parallel stylesheet.
 */

/** "September 17" / "Today" / "Yesterday", as Steam labels its own day rules. */
function formatDayHeading(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return isoDate;

  const date = new Date(year, month - 1, day);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysAgo = Math.round((startOfToday.getTime() - date.getTime()) / 86_400_000);

  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';

  return date.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

interface Props {
  activity: Activity;
  onOpen?: (entry: TimelineEntry) => void;
}

export function ActivityPage({ activity, onOpen }: Props) {
  const summary = activity.post_game_summary;
  const days = activity.timeline;

  // Steam's own screenshot index gives each capture a loopback URL and the
  // handle its media viewer takes (ADR-0019). One call serves the whole page.
  const [index, setIndex] = useState<Map<string, LocalScreenshot>>(new Map());

  useEffect(() => {
    let cancelled = false;
    loadScreenshotIndex()
      .then((loaded) => {
        if (!cancelled) setIndex(loaded);
      })
      .catch(() => {
        /* Cards fall back to base64 thumbnails over RPC. */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const [dismissed, setDismissed] = useState(false);

  if (days.length === 0) {
    return (
      <div data-nsga="activity">
        <EmptyState name={activity.name} />
      </div>
    );
  }

  return (
    <div data-nsga="activity">
      {summary && summary.entries.length > 0 && !dismissed && (
        <PostGameSummary
          summary={summary}
          index={index}
          onOpen={onOpen}
          onDismiss={() => setDismissed(true)}
        />
      )}

      {/*
       * Day heading: Steam's own AppActivityDay/AppActivityDate/Rule, from the
       * activity feed. AppActivityDate is an <h4> with the Rule nested INSIDE
       * it in Steam's real markup, not a sibling div after it (verified).
       *
       * Tile row: Steam's activity feed itself only ever holds `Event` items
       * (achievement unlocks, patch notes, social posts) - it has no tile-grid
       * layout of its own to clone for a row of screenshots. So each day's
       * tiles reuse the SAME SummaryContainer/TypeSeparator pattern the
       * Post-Game Summary carousel uses per-tile (see PostGameSummary below
       * and knowledgebase.md), just without the carousel/pager wrapper around
       * them - one real Steam layout mechanism, applied in both places it is
       * legitimately used for tiles.
       */}
      {days.map((day) => (
        <div key={day.date} className={A.AppActivityDay}>
          <h4 className={A.AppActivityDate}>
            {formatDayHeading(day.date)}
            <div className={A.Rule} />
          </h4>
          {/*
           * width:224px on each tile slot is our own addition, not a Steam
           * class value. In Steam's real carousel, SummaryContainer's width
           * comes from carousel component logic computed in JS, not CSS alone
           * - its `aspect-ratio` tile has nothing to size against otherwise
           * (verified: without this, a tile's own parent chain collapses to
           * 0 width, since `display:block` flex children with no intrinsic
           * size and an aspect-ratio child create a circular sizing case).
           * 224px matches the size Steam itself rendered at when measured
           * (docs/steam-styles.md); a real carousel would vary this by
           * viewport, which we do not attempt to replicate here.
           */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {day.entries.map((entry, i) => (
              <Fragment key={`${entry.type}-${entry.at}-${entry.path}`}>
                {i > 0 && <div className={cx(S.TypeSeparator, 'SpaceOnly')} />}
                <div
                  role="listitem"
                  className={cx(S.SummaryContainer, 'NoAnimation')}
                  style={{ width: '224px', flex: '0 0 auto' }}
                >
                  <div className={S.SummaryContainerChildren}>
                    <MediaCard entry={entry} index={index} onOpen={onOpen} />
                  </div>
                </div>
              </Fragment>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Steam's real Post-Game Summary tree:
 *
 *   PageableContainer.Panel                    <- PageableClasses (module A)
 *   ├─ HeaderPageControls
 *   │  ├─ GamePlaySummaryHeader           "Post-Game Summary"
 *   │  └─ PageClickContainer
 *   │     ├─ PageLeft  [.Disabled at start]   -- only rendered when overflowing
 *   │     ├─ PageRight [.Disabled at end]     -- only rendered when overflowing
 *   │     └─ PageableCloseButton
 *   └─ SummaryCarouselContainer                 <- SummaryClasses (module B)
 *      └─ BoxCarousel > BoxCarouselContents        <- CarouselClasses (module E)
 *         └─ ListElement[role=list]
 *            ├─ SummaryContainer[role=listitem]   -- ONE PER TILE, not per day
 *            │  ├─ EventHeaderBlock                 heading text, or empty
 *            │  └─ SummaryContainerChildren         wraps exactly one tile
 *            ├─ TypeSeparator                       empty spacer between tiles
 *            └─ … repeats …
 *
 * `PageableContainer` and `SummaryCarouselContainer` are TWO DIFFERENT webpack
 * modules (verified by walking Steam's module cache - see classes.ts), so this
 * uses two separate resolved class maps rather than one.
 *
 * The pager (`PageLeft`/`PageRight`) and the actual scroll-by-tile mechanics
 * are real, not a fake disabled pair - see `carousel.tsx` for the reimplemented
 * scrolling primitive (Steam's own module `26271`, walked live) and
 * `ItemCarousel`'s doc comment for why native shows NO arrows at all rather
 * than a disabled pair when everything fits one row. `leftEnabled`/
 * `rightEnabled` here come straight from that carousel's own overflow check,
 * exactly mirroring Steam's real `Pageable` (module `4584`): the arrows only
 * exist in the tree when at least one of them is usable.
 *
 * Verified against a live page holding a clip and screenshots: each was its
 * own `SummaryContainer`/`SummaryContainerChildren` pair, not grouped into one
 * container. Only the first tile in a run of same-day items carries the
 * visible heading text.
 */
function PostGameSummary({
  summary,
  index,
  onOpen,
  onDismiss,
}: {
  summary: NonNullable<Activity['post_game_summary']>;
  index: Map<string, LocalScreenshot>;
  onOpen?: (entry: TimelineEntry) => void;
  onDismiss: () => void;
}) {
  const heading = useMemo(() => {
    if (summary.source === 'session') {
      return new Date(summary.started_at * 1000).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
    }
    return formatDayHeading(summary.date ?? '');
  }, [summary]);

  const carouselRef = useRef<ItemCarouselHandle>(null);
  const [leftEnabled, setLeftEnabled] = useState(false);
  const [rightEnabled, setRightEnabled] = useState(false);
  const showArrows = leftEnabled || rightEnabled;

  const onUpdateArrows = useCallback((left: boolean, right: boolean) => {
    setLeftEnabled(left);
    setRightEnabled(right);
  }, []);

  return (
    <div className={cx(P.PageableContainer, 'Panel')}>
      {/*
       * display:flex here is our own safety net (see media-card.tsx /
       * SummaryCarouselContainer above for the same pattern): title left,
       * controls right, on one row. If `HeaderPageControls` genuinely carries
       * this itself the inline style is redundant and harmless; if a class
       * lookup is ever wrong again (as GamePlaySummaryHeader was, below), the
       * row still lays out correctly instead of stacking.
       */}
      <div
        className={P.HeaderPageControls}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        {/* GamePlaySummaryHeader lives in SummaryClasses (module B), not here -
            HeaderPageControls/PageableContainer/etc are all module A. Mixing
            these up once already made the header render with no class at all
            (its text was then wrongly attributed to HeaderPageControls by a
            naive textContent-based DOM query while debugging). */}
        <div className={S.GamePlaySummaryHeader}>Post-Game Summary</div>
        <div className={cx(P.PageClickContainer)} style={{ display: 'flex', alignItems: 'center' }}>
          {/*
           * Real pager arrows, present only when the carousel itself reports
           * overflow in that direction - matching native exactly (confirmed
           * live: native's own Post-Game Summary shows no arrows at all when
           * every tile fits in one row, not a disabled pair). `.Disabled`
           * greys out whichever single direction is currently unusable while
           * the pair is showing (e.g. scrolled all the way left).
           */}
          {showArrows && (
            <Fragment>
              <div
                role="button"
                tabIndex={0}
                className={cx(P.PageLeft, !leftEnabled && P.Disabled)}
                onClick={() => leftEnabled && carouselRef.current?.scrollLeft()}
                aria-label="Scroll left"
                aria-disabled={!leftEnabled}
              >
                <PageArrowIcon flipped />
              </div>
              <div
                role="button"
                tabIndex={0}
                className={cx(P.PageRight, !rightEnabled && P.Disabled)}
                onClick={() => rightEnabled && carouselRef.current?.scrollRight()}
                aria-label="Scroll right"
                aria-disabled={!rightEnabled}
              >
                <PageArrowIcon />
              </div>
            </Fragment>
          )}
          {/*
           * A `div role="button"`, not a real <button> - Steam's own
           * clickable tiles are all divs (see MediaCard, PostGameSummaryClip
           * etc). A real <button> carries browser-default chrome (white/grey
           * background, border) that PageableCloseButton's CSS was never
           * written to reset, which is why it showed a white box in testing.
           *
           * BUG FOUND LIVE (still visibly wrong after the above fix): this
           * used to be `cx(P.PageableCloseButton, 'Small')` - the literal
           * string 'Small', not `P.Small`. In this module `Small` does NOT
           * resolve to a bare hash the way most modifier classes do - it
           * resolves to a two-token string, "_3qlJ0L41KQFqUTzVQKFERC Small"
           * (confirmed live: `PageableClasses.Small ===
           * "_3qlJ0L41KQFqUTzVQKFERC Small"`). Using the literal string
           * dropped that hash entirely, so native's real 4-token class
           * ("<hash1> PageableCloseButton <hash2> Small") was only ever
           * rendered as 2 tokens here. `PageableCloseButton` itself already
           * bundles its own hash + literal name, which is why that half
           * looked fine in isolation.
           */}
          <div
            role="button"
            tabIndex={0}
            className={cx(P.PageableCloseButton, P.Small)}
            onClick={onDismiss}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onDismiss();
            }}
            aria-label="Dismiss"
          >
            <CloseIcon />
          </div>
        </div>
      </div>

      {/*
       * Real carousel now (see carousel.tsx) - scrolls instead of wrapping,
       * matching native. `SummaryCarouselContainer` is our sizing/spacing
       * wrapper; `ItemCarousel` supplies the actual `BoxCarousel`/
       * `BoxCarouselContents` scrolling behaviour Steam's own component
       * implements (module `26271`, not `@steambrew/client`'s different,
       * windowed `Carousel` - see carousel.tsx for why).
       */}
      <div className={S.SummaryCarouselContainer}>
        <ItemCarousel ref={carouselRef} ariaLabel="Post-Game Summary" onUpdateArrows={onUpdateArrows}>
          {summary.entries.map((entry, i) => (
            <Fragment key={`${entry.type}-${entry.at}-${entry.path}`}>
              {i > 0 && <div className={cx(S.TypeSeparator, 'SpaceOnly')} data-carousel="ignore" />}
              {/* width:224px is our own addition - see the day-feed row
                  above for why a SummaryContainer needs an explicit width. */}
              <div
                role="listitem"
                className={cx(S.SummaryContainer, 'NoAnimation')}
                style={{ width: '224px', flex: '0 0 auto' }}
              >
                {/* Only the first tile carries the visible heading, matching
                    Steam's own real markup. */}
                <div className={S.EventHeaderBlock}>{i === 0 ? heading : ''}</div>
                <div className={S.SummaryContainerChildren}>
                  <MediaCard entry={entry} index={index} onOpen={onOpen} />
                </div>
              </div>
            </Fragment>
          ))}
        </ItemCarousel>
      </div>
    </div>
  );
}

/**
 * Steam's own pager chevron, copied verbatim from the icon component real
 * `Pageable` passes `singlearrow={true}` to (module `50376`, function `be`,
 * walked live - `@steambrew/client` does not export this one either). Single
 * arrow: only the first `polyline` renders (`Arrow2` is skipped when
 * `singlearrow` is set - the un-skipped pair is Steam's *double*-chevron
 * variant used elsewhere, e.g. "skip to end"). Native passes `angle={0}` for
 * `PageLeft` and `angle={180}` for `PageRight` - a rotation on the SAME
 * left-pointing path, not two different paths.
 */
function PageArrowIcon({ flipped = false }: { flipped?: boolean }) {
  return (
    <svg
      // Authored at native's real 256x256 - `SVGIcon_Button` (a global,
      // literal utility class, same as the close icon) does the scaling down
      // to the button's actual 16x16 box, not this attribute. Confirmed live
      // against a native PageLeft: rendered 16x16 despite the 256px attrs.
      style={{ transform: `rotate(${flipped ? 0 : 180}deg)` }}
      version="1.1"
      xmlns="http://www.w3.org/2000/svg"
      className="SVGIcon_Button SVGIcon_DoubleArrow HasHorizontalDirection"
      width="256px"
      height="256px"
      viewBox="0 0 256 256"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="23"
        strokeLinecap="round"
        strokeMiterlimit="10"
        points="135.65,21.667 30.081,127.235 137.18,234.333"
      />
    </svg>
  );
}

/** Steam's own dismiss glyph ("X"), copied from `PageableCloseButton`'s SVG. */
function CloseIcon() {
  return (
    <svg
      viewBox="0 0 256 256"
      width="16"
      height="16"
      className="SVGIcon_Button SVGIcon_X_Line"
      aria-hidden="true"
    >
      <line
        fill="none"
        stroke="currentColor"
        strokeWidth="45"
        strokeMiterlimit="10"
        x1="212"
        y1="212"
        x2="44"
        y2="44"
      />
      <line
        fill="none"
        stroke="currentColor"
        strokeWidth="45"
        strokeMiterlimit="10"
        x1="44"
        y1="212"
        x2="212"
        y2="44"
      />
    </svg>
  );
}

/**
 * Shown when a non-Steam game has no captures at all.
 *
 * Deliberately an invitation rather than Steam's grey "information is
 * unavailable" box - replacing that box is the whole point of the plugin
 * (ADR-0010). No dedicated class module exists for this state in Steam's own
 * UI (there is nothing to clone - a game with zero Steam activity shows
 * nothing at all), so this is plain markup rather than a clone.
 */
function EmptyState({ name }: { name?: string }) {
  return (
    <div data-nsga="empty">
      <div>No activity yet</div>
      <div>
        Screenshots and recordings you capture while playing
        {name ? ` ${name}` : ' this game'} will show up here.
      </div>
    </div>
  );
}
