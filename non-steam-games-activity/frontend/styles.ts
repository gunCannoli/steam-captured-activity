/**
 * Styles for our own nodes.
 *
 * Steam's hashed classes carry the look of anything we render *into* its own
 * containers, but our own elements (the media grid, the empty state) need
 * rules. These use Steam's CSS custom properties so they follow the client's
 * theme instead of hardcoding colours.
 *
 * Injected once per window, since each Steam popup is its own document.
 */

const STYLE_ID = 'nsga-styles';

const CSS = `
.nsga-root {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin: 16px 0 24px;
}

/*
 * All values below are measured from the live Steam client - see
 * docs/steam-styles.md. Do not adjust them by eye; re-measure instead.
 *
 * Section header = GamePlaySummaryHeader.
 */
.nsga-section-title {
  font-size: 14px;
  font-weight: 400;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: rgb(148, 161, 166);
  margin: 0 0 8px;
}

/*
 * No background here. Steam's summary containers are all transparent - the dark
 * panel around them belongs to the surrounding AppDetailsSection. Adding our own
 * produced a visible box-inside-a-box.
 */
/* GamePlaySummaryContainer: transparent, 20px vertical rhythm. */
.nsga-summary {
  margin: 20px 0;
}

.nsga-summary-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 10px;
}

.nsga-summary-date {
  font-size: 14px;
  font-weight: 700;
  color: var(--gpTextColorPrimary, #dcdedf);
  letter-spacing: 0;
  text-transform: none;
}

.nsga-summary-meta {
  font-size: 12px;
  color: var(--gpTextColorSecondary, #8f98a0);
}

.nsga-day { margin-bottom: 20px; }

/* AppActivityDate. Note this grey differs from the summary header's. */
.nsga-day-date {
  font-size: 14px;
  font-weight: 400;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: rgb(138, 138, 138);
  margin-bottom: 6px;
}

.nsga-day-rule {
  height: 1px;
  background: var(--gpSeparatorColor, rgba(255, 255, 255, 0.1));
  margin-bottom: 10px;
}

/*
 * SummaryCarouselContainer. The panel is a radial GRADIENT, not a background
 * colour - checking background-color alone reports transparent, which led to
 * this being wrongly removed once already.
 */
.nsga-carousel {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 0 5px;
  border-radius: 3px;
  background-image: radial-gradient(
    100% 150% at 33% 45%,
    rgba(29, 34, 43, 0.3) 0%,
    rgba(10, 11, 14, 0.3) 100%
  );
}

.nsga-carousel-track {
  display: flex;
  gap: 8px;
  flex: 1;
  overflow: hidden;
}

.nsga-carousel-arrow {
  flex: 0 0 auto;
  width: 24px;
  height: 126px;
  border: 0;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--gpTextColorPrimary, #dcdedf);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.nsga-carousel-arrow:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}

.nsga-carousel-arrow:disabled {
  opacity: 0.25;
  cursor: default;
}

.nsga-media-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* SummaryScreenshot / PostGameSummaryClip: 224x126, square corners, offset shadow. */
.nsga-media-card {
  position: relative;
  width: 224px;
  height: 126px;
  overflow: hidden;
  cursor: pointer;
  background: rgb(0, 0, 0);
  box-shadow: rgb(0, 0, 0) 2px 2px 8px 0px;
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.nsga-media-card:hover,
.nsga-media-card:focus-visible {
  transform: scale(1.03);
  box-shadow: rgb(0, 0, 0) 2px 2px 8px 0px, 0 0 0 2px var(--gpColorHighlight, #1a9fff);
  outline: none;
  z-index: 1;
}

.nsga-media-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* Shown until a thumbnail's data URI arrives over RPC. */
.nsga-media-placeholder {
  background: linear-gradient(
    100deg,
    rgba(255, 255, 255, 0.04) 30%,
    rgba(255, 255, 255, 0.09) 50%,
    rgba(255, 255, 255, 0.04) 70%
  );
  background-size: 200% 100%;
  animation: nsga-shimmer 1.4s ease-in-out infinite;
}

@keyframes nsga-shimmer {
  from { background-position: 150% 0; }
  to   { background-position: -50% 0; }
}

/* Steam marks a clip with a golden scissors glyph and its duration. */
.nsga-media-badge {
  position: absolute;
  left: 6px;
  bottom: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.75);
  color: #e5c15a;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;
}

.nsga-empty {
  padding: 20px;
  border-radius: 3px;
  background: var(--gpBackgroundDark, rgba(0, 0, 0, 0.2));
}

.nsga-empty-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--gpTextColorPrimary, #dcdedf);
  margin-bottom: 4px;
}

.nsga-empty-body {
  font-size: 13px;
  color: var(--gpTextColorSecondary, #8f98a0);
}
`;

/** Inject our stylesheet into a window, once. */
export function ensureStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;

  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}
