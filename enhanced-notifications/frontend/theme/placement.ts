import { STEAM_IN_MS, type Edges, type ToastPosition } from './theme.ts';

/**
 * Where a desktop or overlay toast popup goes. Pure: no Steam or SDK imports (tests/placement.test.ts).
 *
 * Steam keeps its own toast loop (verified live 2026-10-01, docs/steam-components.md § Desktop toast stack): every
 * frame of its slide in, slide out and restack it calls the popup's `MoveTo(x, y)` in the popup's `screen.avail*` CSS
 * px, anchored at its own corner, newest toast nearest the corner and older ones pushed inward by one toast height.
 * We do not replace that loop. Each call is turned into "how far inward from Steam's corner" (`offset`, negative
 * while the toast slides in from past the screen edge) and that same offset is applied from the theme's corner. So
 * Steam's timing and stacking are kept and only the corner and margin change.
 */

/** Steam's fixed toast width (`H=283` in its stack, whatever the popup's real size). */
export const STEAM_TOAST_WIDTH = 283;
/** Steam's toast height and stack step, in avail px. Used until the popup reports a size. */
export const STEAM_TOAST_HEIGHT = 70;

export interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export type Corner = 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';

/**
 * Steam's corner, read from the first `MoveTo` of a popup: Steam starts a toast past its anchored edge (below the
 * screen for a bottom corner) and on its anchored side. Steam has only these four corners.
 */
export function steamCorner(x: number, y: number, size: { width: number; height: number }, avail: Rect): Corner {
    const bottom = y + size.height / 2 > avail.top + avail.height / 2;
    const right = x + size.width / 2 > avail.left + avail.width / 2;
    return `${bottom ? 'bottom' : 'top'}_${right ? 'right' : 'left'}`;
}

/** How far inward from `corner`'s horizontal edge Steam put the toast: 0 at rest in the first stack slot. */
export function stackOffset(corner: Corner, y: number, height: number, avail: Rect): number {
    return corner.startsWith('bottom_') ? avail.top + avail.height - height - y : y - avail.top;
}

/**
 * The popup's place for one of Steam's moves. `margin` pushes it inward from the theme's corner, only on the sides the
 * corner is anchored to (enhanced-achievements' rule); the horizontal margins are ignored for the centred positions.
 * Not clamped to the screen: the slide in starts past the edge on purpose.
 */
export function placeToast(
    position: ToastPosition,
    margin: Edges,
    offset: number,
    size: { width: number; height: number },
    avail: Rect,
): { x: number; y: number } {
    let x: number;
    if (position.endsWith('_left')) x = avail.left + margin.left;
    else if (position.endsWith('_right')) x = avail.left + avail.width - size.width - margin.right;
    else x = avail.left + (avail.width - size.width) / 2;
    const y = position.startsWith('top_') ? avail.top + margin.top + offset : avail.top + avail.height - size.height - margin.bottom - offset;
    return { x: Math.round(x), y: Math.round(y) };
}

/**
 * The offset to use while a theme animation runs instead of Steam's slide. The toast does not travel past its slot:
 * during the slide in (offset below 0) it stays at the corner, and once Steam's slide out starts (after the slide in
 * and the type's display time) it stays where it is, so a toast leaving from an inner slot does not travel across the
 * one nearer the corner. Restacks while it is shown still move it.
 */
export function animatedOffset(offset: number, elapsedMs: number, displayMs: number, last: number | null): number {
    if (last !== null && elapsedMs >= STEAM_IN_MS + displayMs) return last;
    return Math.max(0, offset);
}
