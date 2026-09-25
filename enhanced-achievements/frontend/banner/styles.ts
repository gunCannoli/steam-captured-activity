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
    container-type: size;
}

/* Exterior outline glow (isolated on ::before to never conflict with entrance animations) */
.ea-banner.ea-glow::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: 0 0 var(--ea-glow-spread) var(--ea-glow);
    pointer-events: none;
    z-index: -1;
}
.ea-banner.ea-pulse::before {
    animation: ea-pulse var(--ea-glow-pulse, 1500ms) ease-in-out infinite alternate;
}

.ea-banner.ea-layout-compact_pill {
    border-radius: 999px !important;
    padding: 4px 16px 4px 4px;
}

/* Entrance Animations */
.ea-anim-fade  { animation: ea-anim-fade 400ms cubic-bezier(0.16, 1, 0.3, 1) both; }
.ea-anim-slide { animation: ea-anim-slide 350ms cubic-bezier(0.16, 1, 0.3, 1) both; }
.ea-anim-up    { animation: ea-anim-up 350ms cubic-bezier(0.16, 1, 0.3, 1) both; }
.ea-anim-down  { animation: ea-anim-down 350ms cubic-bezier(0.16, 1, 0.3, 1) both; }

@keyframes ea-anim-fade {
    from { opacity: 0; }
    to { opacity: 1; }
}

@keyframes ea-anim-slide {
    from { opacity: 0; transform: translateX(100%); }
    to { opacity: 1; transform: translateX(0); }
}

@keyframes ea-anim-up {
    from { opacity: 0; transform: translateY(100%); }
    to { opacity: 1; transform: translateY(0); }
}

@keyframes ea-anim-down {
    from { opacity: 0; transform: translateY(-100%); }
    to { opacity: 1; transform: translateY(0); }
}

/* Pulsing outline glow fade */
@keyframes ea-pulse {
    0%, 100% {
        box-shadow: 0 0 calc(var(--ea-glow-spread) * 0.4) var(--ea-glow);
        opacity: 0.6;
    }
    50% {
        box-shadow: 0 0 var(--ea-glow-spread) var(--ea-glow);
        opacity: 1;
    }
}

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

/* PS5-Style Blurry Water Ripple */
.ea-ripple {
    position: absolute;
    inset: -35%;
    border-radius: 50%;
    background: radial-gradient(circle, transparent 40%, rgba(255, 255, 255, 0.35) 55%, rgba(255, 255, 255, 0.75) 70%, transparent 80%);
    filter: blur(4px);
    pointer-events: none;
    animation: ea-ripple var(--ea-ripple) cubic-bezier(0.1, 0.8, 0.3, 1) infinite;
}
@keyframes ea-ripple {
    0% { transform: scale(0.6); opacity: 1; }
    70% { opacity: 0.6; }
    100% { transform: scale(1.8); opacity: 0; }
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
    height: 100%;
    max-height: calc(56px * var(--ea-icon-scale, 1));
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
    font-size: min(var(--ea-title-size), 24cqh);
    flex: 1;
    min-width: 0;
}
.ea-desc {
    font-size: min(var(--ea-desc-size), 18cqh);
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
    height: 60%;
    max-height: calc(34px * var(--ea-icon-scale, 1));
    aspect-ratio: 1;
}
.ea-zone-right .ea-system {
    height: 48%;
}
.ea-zone-right .ea-system svg {
    fill: currentColor;
    color: #ffffff;
}

/* Classic fallback / compatibility classes */
.ea-achievement { height: 100%; max-height: calc(56px * var(--ea-icon-scale, 1)); aspect-ratio: 1; }
.ea-achievement img { border-radius: 4px; }
.ea-badges { display: flex; align-items: center; gap: 6px; margin-left: auto; height: 100%; }
.ea-badges .ea-icon { height: 60%; max-height: calc(34px * var(--ea-icon-scale, 1)); aspect-ratio: 1; }
.ea-badges .ea-system { height: 48%; }
.ea-badges .ea-system svg { fill: currentColor; color: #ffffff; }
.ea-text { min-width: 0; flex: 1; display: flex; flex-direction: column; justify-content: center; gap: var(--ea-gap-y, 2px); line-height: 1.2; text-align: var(--ea-text-align, left); }
`;
