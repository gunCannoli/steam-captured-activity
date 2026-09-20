import { SuspensefulImage } from '@steambrew/client';
import { useEffect, useState } from 'react';
import type { TimelineEntry } from '../rpc';
import { loadThumbnails, peekThumbnail } from '../assets';
import { normaliseKey, screenshotUrl, type LocalScreenshot } from '../steam-media';
import { ClipClasses as C, ScreenshotClasses as SC, SummaryClasses as S, cx } from './classes';

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
 * One screenshot or recording tile.
 *
 * This clones Steam's own `SummaryScreenshot` / `PostGameSummaryClip` markup
 * exactly (see knowledgebase.md "The real Post-Game Summary DOM, verbatim"),
 * down to the `aspect-ratio: 16/9` inline style Steam itself uses instead of a
 * fixed pixel box, and the real `CornerContent`/`DurationText` wrapper around a
 * clip's duration. No bespoke card styling is layered on top - the classes
 * carry it.
 *
 * The tile's outer class and its image class come from TWO DIFFERENT webpack
 * modules for each tile type (`SummaryClasses` for the outer div,
 * `ClipClasses`/`ScreenshotClasses` for the inner parts) - see classes.ts for
 * why they cannot be resolved from one `findClassModule` call.
 *
 * The loading state (while an image decodes) is `@steambrew/client`'s own
 * `SuspensefulImage` - Steam's answer to "what shows before an image is
 * ready" (a `Spinner`, then "Missing image" on error) - rather than a
 * hand-written shimmer placeholder.
 *
 * Images come from Steam's own loopback URLs when the capture is in its index
 * (ADR-0019) - no RPC, no base64, and normal browser caching. Captures Steam
 * does not know about fall back to a base64 data URI over RPC; that fallback
 * source is resolved here (it needs an RPC round trip) and then handed to
 * `SuspensefulImage` like any other `src`.
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
        /* SuspensefulImage shows its own "Missing image" state on a bad src. */
      });

    return () => {
      cancelled = true;
    };
  }, [directUrl, fallbackSource, fallbackUri]);

  const src = directUrl ?? fallbackUri;
  const isRecording = entry.type === 'recording';

  // Outer tile div: "PostGameSummaryClip Panel" or
  // "SummaryScreenshot ClickableScreenshot Panel". `Panel` is Steam's generic
  // clickable-surface utility class, present on both in the real DOM.
  const tileClass = isRecording
    ? cx(C.PostGameSummaryClip, 'Panel')
    : cx(S.SummaryScreenshot, SC.ClickableScreenshot, 'Panel');
  const imgClass = isRecording ? C.ClipThumbnail : SC.ClickableScreenshotImg;

  return (
    <div
      data-nsga="media-card"
      className={tileClass}
      // Steam authors this as aspect-ratio, not a fixed pixel box (verified
      // in a live outerHTML capture), so the tile flexes with its row.
      // IMPORTANT: this alone is not enough - it only constrains the tile's
      // own box. Without the real `position: relative` + sizing rules that
      // come from `tileClass` actually resolving to Steam's real hash, the
      // *image inside* can still overflow the tile (this happened once: the
      // tile class silently resolved to "" and the child image rendered at
      // its natural 1920px width instead of being clipped to the tile).
      style={{ aspectRatio: '1.77778 / 1', position: 'relative', overflow: 'hidden' }}
      onClick={() => onOpen?.(entry)}
      role="button"
      tabIndex={0}
      title={new Date(entry.at * 1000).toLocaleString()}
    >
      {src && (
        <SuspensefulImage
          className={imgClass}
          src={src}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      )}

      {isRecording && (
        <div className={C.CornerContent}>
          {/*
           * BUG FOUND LIVE: this used to be `cx(C.DurationText, 'Clip')` -
           * the literal string 'Clip', not `C.Clip`'s resolved hash. Native's
           * amber colour (rgb(255,213,95), confirmed live) lives specifically
           * in the `.Clip` class's own hash-scoped rule, not in `DurationText`
           * alone - `DurationText`'s own base colour is blue
              (rgb(26,159,255), Steam's default highlight colour), which is
           * exactly the wrong blue we were rendering. Native's real class
           * order is "DurationText Clip", both hashes present - verified by
           * comparing `badge.className` against a real native clip tile.
           */}
          <div className={cx(C.DurationText, C.Clip)}>
            <ClipIcon />
            {entry.duration_ms ? formatDuration(entry.duration_ms) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Steam's own clip icon, copied verbatim (path data captured live from a
 * `DurationText.Clip > svg` element) rather than a hand-drawn scissors glyph.
 *
 * width/height=24 to match native exactly - it does NOT scale the SVG down via
 * these attributes; native measured at a non-square 20x25px, meaning its
 * container (line-height + padding on DurationText/Clip) does the
 * constraining, not an explicit small icon size. We were hardcoding 14x14,
 * which is why ours looked smaller regardless of color.
 */
function ClipIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M22.6666 6.28132C21.6224 4.93909 19.6646 4.66055 18.2811 5.64821L11.1024 10.8143L8.88352 9.21887C8.64856 9.04164 8.51804 8.73769 8.5964 8.45915C8.72692 7.92736 8.75301 7.37017 8.62249 6.78778C8.30928 5.39495 7.10839 4.28069 5.6466 4.05277C3.34942 3.67291 1.33939 5.39499 1.33939 7.57283C1.33939 9.54815 2.984 11.1435 5.0201 11.1435C5.72487 11.1435 6.35139 10.9663 6.92575 10.637C7.18679 10.4851 7.52619 10.5104 7.76104 10.6877L9.90155 12.2324L7.76104 13.7772C7.52608 13.9544 7.18679 13.9798 6.92575 13.8278C6.19479 13.3973 5.30733 13.22 4.36753 13.3719C2.80127 13.6504 1.57437 14.8913 1.36554 16.4361C1.05233 18.7659 3.06232 20.7159 5.46391 20.4627C7.08233 20.2854 8.4137 19.0445 8.67474 17.4744C8.75309 16.9679 8.72691 16.4614 8.59639 16.0056C8.51804 15.727 8.64856 15.4231 8.88352 15.2458L11.1024 13.6504L18.2811 18.8165C19.6646 19.8295 21.6224 19.5509 22.6666 18.1834L14.3915 12.2322L22.6666 6.28132ZM5.02009 9.06697C4.1848 9.06697 3.47992 8.40856 3.47992 7.57283C3.47992 6.7625 4.15861 6.07868 5.02009 6.07868C5.85538 6.07868 6.56027 6.73709 6.56027 7.57283C6.56027 8.38324 5.88158 9.06697 5.02009 9.06697ZM5.02009 18.3863C4.1848 18.3863 3.47992 17.7278 3.47992 16.8921C3.47992 16.0818 4.15861 15.398 5.02009 15.398C5.85538 15.398 6.56027 16.0564 6.56027 16.8921C6.56027 17.7024 5.88158 18.3863 5.02009 18.3863ZM12.4076 12.9416C12.016 12.9416 11.6766 12.6123 11.6766 12.2324C11.6766 11.8526 12.016 11.5233 12.4076 11.5233C12.7992 11.5233 13.1386 11.8526 13.1386 12.2324C13.1385 12.6123 12.8253 12.9416 12.4076 12.9416Z"
        fill="currentColor"
      />
    </svg>
  );
}
