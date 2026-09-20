import { Fragment, useEffect, useMemo, useState } from 'react';
import type { Activity, TimelineEntry } from '../rpc';
import { loadScreenshotIndex, type LocalScreenshot } from '../steam-media';
import { ActivityClasses as A, PageableClasses as P, SummaryClasses as S, cx } from './classes';
import { hasRealCarousel, PlainFallbackCarousel, RealPostGameSummaryShell } from './carousel';
import { MediaCard } from './media-card';

/**
 * Steam's own rule for whether a `TypeSeparator` between two adjacent tiles
 * shows a dot or is invisible spacing only (**decompiled from the real
 * component**, module `53074` - see knowledgebase.md "Reusing Steam's native
 * UI"). The dot is Steam's way of grouping visually-similar tiles together
 * and marking a genuine change of kind:
 *
 *   function isMediaFamily(kind) {
 *     switch (kind) { case Screenshot: case Clip: case RecordingHighlights:
 *       return true; }
 *     return false;
 *   }
 *   function spaceOnly(prevKind, kind) {
 *     return prevKind == kind || (isMediaFamily(prevKind) && isMediaFamily(kind));
 *   }
 *
 * So the dot is NOT "always between different item kinds" (screenshot next
 * to a clip still gets `spaceOnly`, no dot - both are "media") - it only
 * appears crossing OUT of or INTO the media family, e.g. media next to an
 * achievement or a trading card. Confirmed live on Fields of Mistria
 * (appid 2142790): a screenshot tile followed by an achievement-stack tile
 * has a bare `TypeSeparator` with no `SpaceOnly` modifier at all - the dot
 * renders. `non-steam-games-activity`'s own entries today are only
 * `screenshot`/`recording` (both "media"), so this is a no-op today - always
 * `spaceOnly` - but is implemented as the real rule rather than a hardcoded
 * `SpaceOnly` so it stays correct once a provider contributes a non-media
 * `kind` (e.g. an achievements provider) into the same feed.
 */
function isMediaKind(type: string): boolean {
  return type === 'screenshot' || type === 'recording';
}

function typeSeparatorIsSpaceOnly(prevType: string, type: string): boolean {
  return prevType === type || (isMediaKind(prevType) && isMediaKind(type));
}

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
                {i > 0 && (
                  <div
                    className={cx(
                      S.TypeSeparator,
                      typeSeparatorIsSpaceOnly(day.entries[i - 1]?.type ?? entry.type, entry.type) &&
                        'SpaceOnly',
                    )}
                  />
                )}
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
 *   PageableContainer.Panel                    <- rendered by the REAL
 *   ├─ HeaderPageControls                          Pageable component now
 *   │  ├─ GamePlaySummaryHeader           "Post-Game Summary" (module `4584`,
 *   │  └─ PageClickContainer                        see carousel.tsx) - not
 *   │     ├─ PageLeft  [.Disabled at start]         hand-built markup.
 *   │     ├─ PageRight [.Disabled at end]
 *   │     └─ PageableCloseButton
 *   └─ SummaryCarouselContainer                 <- SummaryClasses (own module),
 *      └─ BoxCarousel > BoxCarouselContents        wrapping the REAL Carousel
 *         └─ ListElement[role=list]                (module `26271`)
 *            ├─ SummaryContainer[role=listitem]   -- ONE PER TILE, not per day
 *            │  ├─ EventHeaderBlock                 heading text, or empty
 *            │  └─ SummaryContainerChildren         wraps exactly one tile
 *            ├─ TypeSeparator                       empty spacer between tiles
 *            └─ … repeats …
 *
 * This component only supplies the TILES (`tiles` below) - the header, pager
 * arrows and dismiss button are Steam's own real `Pageable`+`Carousel`
 * composition (`RealPostGameSummaryShell`, see carousel.tsx for the full
 * trace and why rendering the real components beats reimplementing their
 * markup/behaviour). Only when they fail to resolve (`hasRealCarousel ===
 * false`, e.g. a Steam update renames every prototype method this looks
 * for) does this fall back to a hand-built header + a plain scrolling row -
 * degraded, but not broken.
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

  const tiles = summary.entries.map((entry, i) => (
    <Fragment key={`${entry.type}-${entry.at}-${entry.path}`}>
      {i > 0 && (
        <div
          className={cx(
            S.TypeSeparator,
            typeSeparatorIsSpaceOnly(summary.entries[i - 1]?.type ?? entry.type, entry.type) && 'SpaceOnly',
          )}
          data-carousel="ignore"
        />
      )}
      {/* width:224px is our own addition - see the day-feed row above for
          why a SummaryContainer needs an explicit width; Steam's real
          carousel computes it in JS (fnGetColumnWidth-equivalent logic
          inside the real Carousel we now render), which this does not
          reach into. */}
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
  ));

  // Renders Steam's REAL Pageable+Carousel (header, dismiss button, pager
  // arrows, scrolling body) - see carousel.tsx for what that means and why.
  // Only if it failed to resolve do we fall back to a plain scrolling row
  // with our own hand-built header, rather than showing nothing.
  if (hasRealCarousel) {
    return (
      <RealPostGameSummaryShell
        name="Post-Game Summary"
        header={<div className={S.GamePlaySummaryHeader}>Post-Game Summary</div>}
        onDismiss={onDismiss}
      >
        {tiles}
      </RealPostGameSummaryShell>
    );
  }

  return (
    <div className={cx(P.PageableContainer, 'Panel')}>
      <div
        className={P.HeaderPageControls}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <div className={S.GamePlaySummaryHeader}>Post-Game Summary</div>
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
      <div className={S.SummaryCarouselContainer}>
        <PlainFallbackCarousel ariaLabel="Post-Game Summary">{tiles}</PlainFallbackCarousel>
      </div>
    </div>
  );
}

/**
 * Steam's own dismiss glyph ("X"), copied from `PageableCloseButton`'s SVG.
 * Only used by the fallback header below (`hasRealCarousel === false`) -
 * when the real `Pageable` renders, it supplies its own close icon and this
 * component is not reached. Kept as a real SVG element rather than removed
 * so the fallback path still looks like Steam's dismiss button, not a
 * generic placeholder.
 */
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
