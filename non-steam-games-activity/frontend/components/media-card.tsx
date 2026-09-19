import { useEffect, useState } from 'react';
import type { TimelineEntry } from '../rpc';
import { loadThumbnails, peekThumbnail } from '../assets';

/** `14144` -> `0:14`, matching the duration badge Steam puts on its own clips. */
function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

interface Props {
  entry: TimelineEntry;
  onOpen?: (entry: TimelineEntry) => void;
}

/**
 * One screenshot or recording.
 *
 * Images arrive as base64 data URIs over RPC (ADR-0017), so a card shows the
 * cached thumbnail immediately when there is one and otherwise loads it. A
 * recording renders its Steam-generated `thumbnail.jpg` with a duration badge:
 * the video itself is MPEG-DASH and cannot play in a plain <video> element.
 */
export function MediaCard({ entry, onOpen }: Props) {
  const source = entry.thumb ?? entry.path;
  const [uri, setUri] = useState<string | undefined>(() => peekThumbnail(source));

  useEffect(() => {
    if (uri || !source) return;

    let cancelled = false;
    loadThumbnails([source])
      .then((map) => {
        if (!cancelled) setUri(map.get(source));
      })
      .catch(() => {
        /* A missing thumbnail is not an error worth surfacing - the card just
           stays a placeholder. */
      });

    return () => {
      cancelled = true;
    };
  }, [source, uri]);

  const isRecording = entry.type === 'recording';

  return (
    <div
      data-nsga="media-card"
      className="nsga-media-card"
      onClick={() => onOpen?.(entry)}
      role="button"
      tabIndex={0}
      title={new Date(entry.at * 1000).toLocaleString()}
    >
      {uri ? (
        <img className="nsga-media-thumb" src={uri} alt="" loading="lazy" />
      ) : (
        <div className="nsga-media-thumb nsga-media-placeholder" />
      )}

      {isRecording && (
        <div className="nsga-media-badge">
          <PlayGlyph />
          {entry.duration_ms ? formatDuration(entry.duration_ms) : null}
        </div>
      )}
    </div>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">
      <path d="M8 5v14l11-7z" fill="currentColor" />
    </svg>
  );
}
