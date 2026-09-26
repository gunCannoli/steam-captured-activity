/**
 * Banner styles, injected with the banner itself so they travel into whichever
 * toast window (desktop popup, Big Picture, overlay) the portal renders into.
 *
 * Everything is scoped under `.ea-banner`; nothing targets Steam's classes.
 * The banner fills Steam's toast frame with responsive scaling and geometry
 * controls (margin, padding, gap), outline glow with pulsing fade, and
 * authentic PS5 blurry water-ripple effects.
 */
export const BANNER_CSS = `
.ea-banner {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: var(--ea-gap-x, 10px);
    padding: var(--ea-pad-y, 6px) var(--ea-pad-x, 10px);
    box-sizing: border-box;
    overflow: hidden;
    font-family: "Motiva Sans", -apple-system, BlinkMacSystemFont, Arial, sans-serif;
    cursor: pointer;
    user-select: none;
}

.ea-banner.ea-layout-compact_pill {
    border-radius: 999px !important;
    padding: 4px 16px 4px 4px;
}

/* Entrance and exit animations, independently settable (themes.md § animation).
   Lengths are set inline from banner/timing.ts (--ea-in-ms, --ea-out-ms), the
   same numbers the scheduler uses to decide when this toast is done; only the
   keyframe names live here. The exit starts after the entrance plus the
   theme's display time (--ea-display-ms), not Steam's --toast-duration: the
   banner owns its lifetime and Steam holds the popup until it is done. */
.ea-banner {
    animation-name: var(--ea-in-name, none), var(--ea-out-name, none);
    animation-duration: var(--ea-in-ms, 0ms), var(--ea-out-ms, 0ms);
    animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1), ease-in;
    animation-delay: 0ms, calc(var(--ea-in-ms, 0ms) + var(--ea-display-ms, 5000ms));
    animation-fill-mode: both, forwards;
}

/* Queued: nothing painted, and Steam's own popup chrome (gradient box and
   logo watermark, the popup div we are a direct child of) hidden too, so a
   waiting popup is fully invisible. :has(> ...) matches only that parent. */
.ea-banner.ea-waiting { visibility: hidden; animation: none; }
:has(> .ea-banner.ea-waiting) { background: none !important; box-shadow: none !important; border-color: transparent !important; }
:has(> .ea-banner.ea-waiting) > :not(.ea-banner) { display: none !important; }
/* Done: stays invisible while Steam fades and closes the popup. Visibility,
   not a class swap, so the finished exit animation is not restarted. */
.ea-banner.ea-done { visibility: hidden; }

/* --- entrance (ea-in-*) --- */
.ea-in-fade  { --ea-in-name: ea-in-fade; }
.ea-in-slide { --ea-in-name: ea-in-slide; }
/* slide mirrors the anchor: left-anchored banners enter from the left edge. */
.ea-in-slide.ea-pos-top_left, .ea-in-slide.ea-pos-bottom_left { --ea-in-name: ea-in-slide-left; }
.ea-in-up    { --ea-in-name: ea-in-up; }
.ea-in-down  { --ea-in-name: ea-in-down; }
.ea-in-none  { --ea-in-name: none; }
/* ps5: slide in from the anchored screen edge + fade, direction from ea-pos-*. */
.ea-in-ps5.ea-pos-top_right, .ea-in-ps5.ea-pos-bottom_right { --ea-in-name: ea-in-slide; }
.ea-in-ps5.ea-pos-top_left,  .ea-in-ps5.ea-pos-bottom_left  { --ea-in-name: ea-in-slide-left; }
.ea-in-ps5.ea-pos-top_center                                { --ea-in-name: ea-in-down; }
.ea-in-ps5.ea-pos-bottom_center                             { --ea-in-name: ea-in-up; }

/* --- exit (ea-out-*) --- */
.ea-out-fade  { --ea-out-name: ea-out-fade; }
.ea-out-slide { --ea-out-name: ea-out-slide; }
.ea-out-slide.ea-pos-top_left, .ea-out-slide.ea-pos-bottom_left { --ea-out-name: ea-out-slide-left; }
.ea-out-up    { --ea-out-name: ea-out-up; }
.ea-out-down  { --ea-out-name: ea-out-down; }
.ea-out-none  { --ea-out-name: none; }
.ea-out-ps5.ea-pos-top_right, .ea-out-ps5.ea-pos-bottom_right { --ea-out-name: ea-out-slide; }
.ea-out-ps5.ea-pos-top_left,  .ea-out-ps5.ea-pos-bottom_left  { --ea-out-name: ea-out-slide-left; }
.ea-out-ps5.ea-pos-top_center                                 { --ea-out-name: ea-out-up; }
.ea-out-ps5.ea-pos-bottom_center                              { --ea-out-name: ea-out-down; }

@keyframes ea-in-fade  { from { opacity: 0; } to { opacity: 1; } }
@keyframes ea-out-fade { from { opacity: 1; } to { opacity: 0; } }

@keyframes ea-in-slide       { from { opacity: 0; transform: translateX(100%); }  to { opacity: 1; transform: translateX(0); } }
@keyframes ea-in-slide-left  { from { opacity: 0; transform: translateX(-100%); } to { opacity: 1; transform: translateX(0); } }
@keyframes ea-out-slide      { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(100%); } }
@keyframes ea-out-slide-left { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(-100%); } }

@keyframes ea-in-up   { from { opacity: 0; transform: translateY(100%); }  to { opacity: 1; transform: translateY(0); } }
@keyframes ea-out-up  { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(100%); } }
@keyframes ea-in-down  { from { opacity: 0; transform: translateY(-100%); } to { opacity: 1; transform: translateY(0); } }
@keyframes ea-out-down { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-100%); } }

/* Base Icon and Scaling */
.ea-icon {
    position: relative;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.ea-icon img, .ea-icon svg {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
}

/* Water-ripple: starts as a ring collapsed onto the icon's own outline and
   expands outward from there (like an object breaking the surface of water),
   not a pre-inflated blurred disc drifting further away. Fixed-size ring
   (inset: 0, same box as the icon) rather than a percentage inset, so it
   always starts exactly at the icon's edge regardless of icon scale. */
.ea-ripple {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: calc(1.5px * var(--ea-icon-scale, 1)) solid rgba(255, 255, 255, 0.85);
    filter: blur(calc(0.65px * var(--ea-icon-scale, 1)));
    pointer-events: none;
    transform: scale(1);
    opacity: 0;
    animation: ea-ripple var(--ea-ripple) cubic-bezier(0.1, 0.8, 0.3, 1) infinite;
}
@keyframes ea-ripple {
    0%   { transform: scale(1);    opacity: 0.9; }
    15%  { opacity: 0.7; }
    100% { transform: scale(1.9);  opacity: 0; }
}

/* 3-Zone Flexbox Architecture */
.ea-zone-left {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
}
.ea-zone-left .ea-icon {
    height: calc(min(56px, var(--ea-inner-h, 56px)) * var(--ea-icon-scale, 1));
    aspect-ratio: 1;
}
.ea-zone-left img {
    border-radius: 4px;
}

.ea-zone-center {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--ea-gap-y, 2px);
    line-height: 1.2;
    text-align: var(--ea-text-align, left);
}

.ea-row-title, .ea-row-desc {
    display: flex;
    align-items: center;
    gap: var(--ea-gap-x, 6px);
    min-width: 0;
    justify-content: var(--ea-text-justify, flex-start);
}

.ea-anchored-icon {
    height: 1.15em;
    width: 1.15em;
    aspect-ratio: 1;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}

.ea-title, .ea-desc {
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: var(--ea-text-align, left);
}
.ea-title {
    white-space: nowrap;
    font-size: var(--ea-title-size);
    flex: 1;
    min-width: 0;
}
.ea-desc {
    font-size: var(--ea-desc-size);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    width: 100%;
}

.ea-zone-right {
    flex: none;
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--ea-gap-x, 6px);
    height: 100%;
}
.ea-zone-right .ea-icon {
    height: calc(min(34px, 0.6 * var(--ea-inner-h, 56px)) * var(--ea-icon-scale, 1));
    aspect-ratio: 1;
}
.ea-zone-right .ea-system {
    height: calc(min(34px, 0.48 * var(--ea-inner-h, 56px)) * var(--ea-icon-scale, 1));
}
.ea-zone-right .ea-system svg {
    fill: currentColor;
    color: #ffffff;
}

/* Classic fallback / compatibility classes */
.ea-achievement { height: calc(min(56px, var(--ea-inner-h, 56px)) * var(--ea-icon-scale, 1)); aspect-ratio: 1; }
.ea-achievement img { border-radius: 4px; }
.ea-badges { display: flex; align-items: center; gap: 6px; margin-left: auto; height: 100%; }
.ea-badges .ea-icon { height: calc(min(34px, 0.6 * var(--ea-inner-h, 56px)) * var(--ea-icon-scale, 1)); aspect-ratio: 1; }
.ea-badges .ea-system { height: calc(min(34px, 0.48 * var(--ea-inner-h, 56px)) * var(--ea-icon-scale, 1)); }
.ea-badges .ea-system svg { fill: currentColor; color: #ffffff; }
.ea-text { min-width: 0; flex: 1; display: flex; flex-direction: column; justify-content: center; gap: var(--ea-gap-y, 2px); line-height: 1.2; text-align: var(--ea-text-align, left); }
`;
