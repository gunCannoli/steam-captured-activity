/**
 * Banner styles, injected with the banner itself so they travel into whichever
 * toast window (desktop popup, Big Picture, overlay) the portal renders into.
 *
 * Everything is scoped under `.ea-banner`; nothing targets Steam's classes.
 * The banner fills Steam's toast frame. Steam sizes that frame (the desktop
 * popup is a fixed 284×71 window), so `scale` enlarges text and icons, not the
 * window. Text sizes are capped relative to the frame height (container `cqh`
 * units) so a large scale never clips the title on a small frame.
 */
export const BANNER_CSS = `
.ea-banner {
    position: absolute; inset: 0; z-index: 1;
    display: flex; align-items: center; gap: calc(10px * var(--ea-scale));
    padding: 6px 10px; box-sizing: border-box; overflow: hidden;
    font-family: "Motiva Sans", Arial, sans-serif; cursor: pointer; user-select: none;
    container-type: size;
}
.ea-banner.ea-glow { box-shadow: inset 0 0 var(--ea-glow-spread) var(--ea-glow); }
.ea-banner.ea-pulse { animation: ea-enter 300ms ease-out both, ea-pulse var(--ea-glow-pulse) ease-in-out infinite alternate; }
.ea-banner.ea-layout-compact_pill { border-radius: 999px !important; padding: 4px 16px 4px 4px; }

.ea-anim-slide { animation: ea-enter 300ms ease-out both; --ea-from: translateX(100%); }
.ea-anim-fade  { animation: ea-enter 300ms ease-out both; --ea-from: none; }
.ea-anim-up    { animation: ea-enter 300ms ease-out both; --ea-from: translateY(100%); }
.ea-anim-down  { animation: ea-enter 300ms ease-out both; --ea-from: translateY(-100%); }
@keyframes ea-enter { from { opacity: 0; transform: var(--ea-from); } to { opacity: 1; transform: none; } }
@keyframes ea-pulse { from { box-shadow: inset 0 0 0 var(--ea-glow); } to { box-shadow: inset 0 0 var(--ea-glow-spread) var(--ea-glow); } }

.ea-icon { position: relative; flex: none; display: flex; align-items: center; justify-content: center; }
.ea-icon img, .ea-icon svg { display: block; width: 100%; height: 100%; object-fit: contain; }
.ea-achievement { height: 100%; max-height: calc(56px * var(--ea-scale)); aspect-ratio: 1; }
.ea-achievement img { border-radius: 2px; }
.ea-badges { display: flex; align-items: center; gap: 6px; margin-left: auto; height: 100%; }
.ea-badges .ea-icon { height: 60%; max-height: calc(34px * var(--ea-scale)); aspect-ratio: 1; }
.ea-badges .ea-system { height: 45%; }
.ea-badges .ea-system svg { fill: currentColor; color: #ffffff; }

.ea-ripple { position: absolute; inset: 0; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.6); animation: ea-ripple var(--ea-ripple) ease-out infinite; pointer-events: none; }
@keyframes ea-ripple { from { transform: scale(0.8); opacity: 0.9; } to { transform: scale(1.6); opacity: 0; } }

.ea-text { min-width: 0; flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 2px; line-height: 1.2; }
.ea-title, .ea-desc { overflow: hidden; text-overflow: ellipsis; }
.ea-title { white-space: nowrap; font-size: min(var(--ea-title-size), 24cqh); }
.ea-desc { font-size: min(var(--ea-desc-size), 18cqh); }
.ea-desc { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
`;
