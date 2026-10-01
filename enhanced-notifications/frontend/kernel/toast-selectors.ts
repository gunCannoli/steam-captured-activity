/**
 * Kernel: the CSS selectors for Steam's toast parts. steam/selectors.ts resolves
 * them from Steam's CSS modules; theme/theme.ts builds rules with them. Kept here
 * so the Steam layer never imports the theme. Pure.
 */

/** Selectors for Steam's toast parts, each an `:is(...)` over every module's hashed class. */
export interface ToastSelectors {
    desktopPopup?: string;
    gamepadPopup?: string;
    watermark?: string;
    templates?: string; // StandardTemplateContainer, ShortTemplate, DesktopToastTemplate
    shortTemplate?: string;
    title?: string;
    body?: string; // Body + StandardNotificationDescription
    subtext?: string;
    logoBox?: string; // StandardLogoDimensions + ShortLogoDimensions
    appLogo?: string;
    headerIcon?: string;
}
