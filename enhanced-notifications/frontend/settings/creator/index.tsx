import { showDialog } from "../../steam/modal";
import { ThemeCreator, type CreatorDeps } from "./theme-creator";

export type { CreatorDeps } from "./theme-creator";
export type { CreatorBannerProps, SampleGame } from "./preview";

/**
 * Open the Theme Creator (theme creator plan § 4.2): a big popout on desktop, sized to the screen (1100-1280 x
 * 720-860). Millennium's plugin settings exist only on desktop, so the creator does too; it edits the Big Picture look
 * from there (ADR-0068).
 */
export function openThemeCreator(deps: CreatorDeps): void {
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    const popupWidth = Math.round(clamp(0.92 * window.screen.availWidth, 1100, 1280));
    const popupHeight = Math.round(clamp(0.9 * window.screen.availHeight, 720, 860));
    showDialog(<ThemeCreator deps={deps} />, { strTitle: "Theme Creator", popupWidth, popupHeight });
}
