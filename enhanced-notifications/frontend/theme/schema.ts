/**
 * The names and shapes both halves of a theme share: the notification style (./theme.ts) and the optional
 * `achievements` block (./achievements.ts). One definition, so a position or an animation means the same thing in both.
 * Pure: no imports at all (tests/theme.test.ts).
 */

/**
 * The `theme` setting's value for "Steam default": no theme, every notification keeps Steam's own look, sound and
 * display time. `<` and `>` cannot be in a Windows file name, so no theme file can take this name.
 */
export const STEAM_DEFAULT_THEME = '<steam>';

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

/**
 * `settings.hover`: the highlight when the mouse is over a toast. `enabled: false` draws none; `color: null` is Steam's
 * own (a blue radial gradient at 50%), else that colour at 50%. Steam's own when the theme does not set it.
 */
export interface HoverSpec {
    enabled: boolean;
    color: string | null;
}

/** Steam's own toast hover (DesktopToastPopup::before, verified live 2026-10-02): this gradient at 50% opacity, 0.3 s. */
export const STEAM_HOVER_GRADIENT = 'radial-gradient(155.42% 100% at 0% 0%, rgb(31, 42, 57) 0px, rgb(31, 42, 57) 0%, rgba(26, 160, 255, 0.325) 100%)';

export interface SoundSpec {
    path: string;
    volumePct: number;
}

export const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];
