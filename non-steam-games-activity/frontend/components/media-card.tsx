import { useEffect, useState } from 'react';
import type { TimelineEntry } from '../rpc';
import { loadThumbnails, peekThumbnail } from '../assets';
import { normaliseKey, screenshotUrl, type LocalScreenshot } from '../steam-media';
import { SummaryClasses, cx } from './classes';

/** `14144` -> `0:14`, matching the duration Steam shows on its own clips. */
function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

interface Props {
  entry: TimelineEntry;
  /** Steam's screenshot index, keyed by `normaliseKey`. */
  index: Map<string, LocalScreenshot>;
  onOpen?: (entry: TimelineEntry) => void;
}

/**
 * One screenshot or recording.
 *
 * Images come from Steam's own loopback URLs when the capture is in its index
 * (ADR-0019) - no RPC, no base64, and normal browser caching. Captures Steam
 * does not know about fall back to a base64 data URI over RPC.
 */
export function MediaCard({ entry, index, onOpen }: Props) {
  const shot = index.get(normaliseKey(entry.path) ?? '');
  const directUrl = shot ? screenshotUrl(shot, true) : undefined;

  // Only used when Steam has no record of this capture.
  const fallbackSource = directUrl ? undefined : (entry.thumb ?? entry.path);
  const [fallbackUri, setFallbackUri] = useState<string | undefined>(() =>
    peekThumbnail(fallbackSource),
  );

  useEffect(() => {
    if (directUrl || fallbackUri || !fallbackSource) return;

    let cancelled = false;
    loadThumbnails([fallbackSource])
      .then((map) => {
        if (!cancelled) setFallbackUri(map.get(fallbackSource));
      })
      .catch(() => {
        /* A missing thumbnail leaves a placeholder; not worth surfacing. */
      });

    return () => {
      cancelled = true;
    };
  }, [directUrl, fallbackSource, fallbackUri]);

  const src = directUrl ?? fallbackUri;
  const isRecording = entry.type === 'recording';

  return (
    <div
      data-nsga="media-card"
      className={cx('nsga-media-card', isRecording && SummaryClasses.PostGameSummaryClip)}
      onClick={() => onOpen?.(entry)}
      role="button"
      tabIndex={0}
      title={new Date(entry.at * 1000).toLocaleString()}
    >
      {src ? (
        <img
          className={cx('nsga-media-thumb', isRecording && SummaryClasses.ClipThumbnail)}
          src={src}
          alt=""
          loading="lazy"
        />
      ) : (
        <div className="nsga-media-thumb nsga-media-placeholder" />
      )}

      {isRecording && (
        // Steam marks a clip with a golden scissors glyph and its duration.
        <div className="nsga-media-badge">
          <ScissorsGlyph />
          {entry.duration_ms ? formatDuration(entry.duration_ms) : null}
        </div>
      )}
    </div>
  );
}

/** Steam's clip marker: open scissors, in its gold accent. */
function ScissorsGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <line x1="20" y1="4" x2="8.12" y2="15.88" />
        <line x1="14.47" y1="14.48" x2="20" y2="20" />
        <line x1="8.12" y1="8.12" x2="12" y2="12" />
      </g>
    </svg>
  );
}
