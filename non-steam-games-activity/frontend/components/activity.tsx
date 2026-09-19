import { useEffect, useRef, useState } from 'react';
import type { Activity, TimelineEntry } from '../rpc';
import { loadScreenshotIndex, type LocalScreenshot } from '../steam-media';
import { ActivityClasses as A, SummaryClasses as S, cx } from './classes';
import { MediaCard } from './media-card';

/**
 * The page body: a session-scoped post-game summary, then activity by day.
 *
 * This mirrors Steam's own two-scope layout - the summary covers the most
 * recent play session, while the feed below covers all history grouped by
 * calendar date. Both come from one `GetActivity` payload.
 */

/** "SEPTEMBER 17" / "TODAY" / "YESTERDAY", as Steam labels its own day rules. */
function formatDayHeading(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return isoDate;

  const date = new Date(year, month - 1, day);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysAgo = Math.round((startOfToday.getTime() - date.getTime()) / 86_400_000);

  if (daysAgo === 0) return 'TODAY';
  if (daysAgo === 1) return 'YESTERDAY';

  return date
    .toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
    })
    .toUpperCase();
}

function summariseEntries(entries: TimelineEntry[]): string {
  const screenshots = entries.filter((e) => e.type === 'screenshot').length;
  const recordings = entries.filter((e) => e.type === 'recording').length;

  const parts: string[] = [];
  if (screenshots) parts.push(`${screenshots} screenshot${screenshots === 1 ? '' : 's'}`);
  if (recordings) parts.push(`${recordings} recording${recordings === 1 ? '' : 's'}`);
  return parts.join(' · ');
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

  if (days.length === 0) {
    return (
      <div data-nsga="activity" className="nsga-root">
        <EmptyState name={activity.name} />
      </div>
    );
  }

  return (
    <div data-nsga="activity" className="nsga-root">
      {summary && summary.entries.length > 0 && (
        <section className="nsga-section">
          <h2 className="nsga-section-title">POST-GAME SUMMARY</h2>
          <div className="nsga-summary">
            <div className="nsga-summary-head">
              <span className="nsga-summary-date">
                {summary.source === 'session'
                  ? new Date(summary.started_at * 1000).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })
                  : formatDayHeading(summary.date ?? '')}
              </span>
              <span className="nsga-summary-meta">{summariseEntries(summary.entries)}</span>
            </div>
            <SummaryCarousel entries={summary.entries} index={index} onOpen={onOpen} />
          </div>
        </section>
      )}

      <section className="nsga-section">
        <h2 className="nsga-section-title">ACTIVITY</h2>
        {days.map((day) => (
          <div key={day.date} className={cx(A.AppActivityDay, 'nsga-day')}>
            <div className={cx(A.AppActivityDate, 'nsga-day-date')}>
              {formatDayHeading(day.date)}
            </div>
            <div className={cx(A.Rule, 'nsga-day-rule')} />
            <div className="nsga-media-row">
              {day.entries.map((entry) => (
                <MediaCard
                  key={`${entry.type}-${entry.at}-${entry.path}`}
                  entry={entry}
                  index={index}
                  onOpen={onOpen}
                />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

/**
 * Shown when a non-Steam game has no captures at all.
 *
 * Deliberately an invitation rather than Steam's grey "information is
 * unavailable" box - replacing that box is the whole point of the plugin
 * (ADR-0010).
 */
function EmptyState({ name }: { name?: string }) {
  return (
    <div className="nsga-empty">
      <div className="nsga-empty-title">No activity yet</div>
      <div className="nsga-empty-body">
        Screenshots and recordings you capture while playing
        {name ? ` ${name}` : ' this game'} will show up here.
      </div>
    </div>
  );
}

/**
 * Steam's post-game summary is a single row showing a few items at a time, with
 * arrows to page through the rest. This mirrors that rather than wrapping
 * everything onto multiple lines.
 */
function SummaryCarousel({
  entries,
  index,
  onOpen,
}: {
  entries: TimelineEntry[];
  index: Map<string, LocalScreenshot>;
  onOpen?: (entry: TimelineEntry) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);

  /** How many cards fit at once, matching Steam's 3-4 per row. */
  const PAGE = 4;
  const maxOffset = Math.max(0, entries.length - PAGE);
  const visible = entries.slice(offset, offset + PAGE);

  return (
    // Steam's own SummaryCarouselContainer carries a panel background in this
    // position, which doubles up with the section's. Use our own layout class
    // and borrow only the inner scrolling container's spacing.
    <div className="nsga-carousel">
      {maxOffset > 0 && (
        <button
          type="button"
          className="nsga-carousel-arrow"
          disabled={offset === 0}
          onClick={() => setOffset((value) => Math.max(0, value - 1))}
          aria-label="Previous"
        >
          ‹
        </button>
      )}

      <div
        ref={scroller}
        className={cx(S.SummaryCarouselScrollingContainer, 'nsga-carousel-track')}
      >
        {visible.map((entry) => (
          <MediaCard
            key={`${entry.type}-${entry.at}-${entry.path}`}
            entry={entry}
            index={index}
            onOpen={onOpen}
          />
        ))}
      </div>

      {maxOffset > 0 && (
        <button
          type="button"
          className="nsga-carousel-arrow"
          disabled={offset >= maxOffset}
          onClick={() => setOffset((value) => Math.min(maxOffset, value + 1))}
          aria-label="Next"
        >
          ›
        </button>
      )}
    </div>
  );
}
