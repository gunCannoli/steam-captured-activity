/**
 * The names and shapes both halves of a theme share: the notification style (./theme.ts) and the optional
 * `achievements` block (./achievements.ts). One definition, so a position or an animation means the same thing in both.
 * Pure: no imports at all (tests/theme.test.ts).
 */

export const POSITIONS = ['top_right', 'top_left', 'bottom_right', 'bottom_left', 'top_center', 'bottom_center'] as const;
export type ToastPosition = (typeof POSITIONS)[number];

export const ANIMATIONS = ['slide', 'fade', 'up', 'down', 'ps5', 'none'] as const;
export type Animation = (typeof ANIMATIONS)[number];

export interface AnimationPair {
    in: Animation;
    out: Animation;
}

/** One px value per side, for `margin` and `padding`. */
export interface Edges {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

export type FontStyle = 'bold' | 'regular' | 'italic';

export interface SoundSpec {
    path: string;
    volumePct: number;
}

export const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];
