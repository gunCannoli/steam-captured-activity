import type { BannerStyle, Edges, Layout, ToastPosition } from '../theme/achievements';

/**
 * Banner window geometry. Pure: no Steam or SDK imports (tests/geometry.test.ts).
 *
 * All values are CSS px in the toast popup's `screen.avail*` space, the space
 * Steam's own toast loop uses (verified live 2026-09-25, see
 * docs/steam-components.md § Desktop toast stack).
 */

export const STACK_GAP_PX = 8;

export interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface BannerSize {
    baseW: number;
    baseH: number;
    /** Window and box size: base × scale. */
    width: number;
    height: number;
    /** Content height of the unscaled box; content is sized from this, never from `scale`. */
    innerH: number;
}

export function bannerSize(layout: Layout, banner: BannerStyle): BannerSize {
    const wide = layout === 'ps5' || layout === 'custom' || layout === 'default_system_right';
    const baseW = banner.width ?? (wide ? 400 : 283);
    const baseH = banner.height ?? (layout === 'compact_pill' ? 48 : 70);
    return {
        baseW,
        baseH,
        width: Math.round((baseW * banner.scale[0]) / 100),
        height: Math.round((baseH * banner.scale[1]) / 100),
        innerH: Math.max(0, baseH - banner.padding.top - banner.padding.bottom - 2 * banner.border.width),
    };
}

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

/** `margin` pushes the banner inward from its anchor corner: only the sides it is anchored to count. */
export function placeBanner(
    position: ToastPosition,
    margin: Edges,
    size: { width: number; height: number },
    avail: Rect,
    slot = 0,
): { x: number; y: number } {
    const { width: w, height: h } = size;
    const step = slot * (h + STACK_GAP_PX);

    let x: number;
    if (position.endsWith('_left')) x = avail.left + margin.left;
    else if (position.endsWith('_right')) x = avail.left + avail.width - w - margin.right;
    else x = avail.left + Math.round((avail.width - w) / 2);

    let y = position.startsWith('top_') ? avail.top + margin.top + step : avail.top + avail.height - h - margin.bottom - step;

    x = clamp(x, avail.left, avail.left + Math.max(0, avail.width - w));
    y = clamp(y, avail.top, avail.top + Math.max(0, avail.height - h));
    return { x: Math.round(x), y: Math.round(y) };
}
