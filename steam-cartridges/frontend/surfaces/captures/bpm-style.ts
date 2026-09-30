// Surface `captures`: Big Picture activity thumbnail styling (migration plan M3.2; M10: driven by the
// view sensor's window.opened / window.closed, it watches no popups itself). A <style> element in the
// gamepad window's document is a Steam write.
import { deps } from "./deps";

const STYLE_ID = "nsga-bpm-activity-thumbs";

const STYLE = `
          [class*="CarouselThumbs"] {
            display: flex !important;
            flex-direction: row !important;
            overflow-x: auto !important;
            overflow-y: hidden !important;
            gap: 16px !important;
            width: 100% !important;
            max-width: 100% !important;
            flex: 1 1 auto !important;
          }
          [class*="CarouselThumb"]:not([class*="CarouselThumbs"]) {
            width: 320px !important;
            height: 180px !important;
            max-width: 320px !important;
            max-height: 180px !important;
            flex: 0 0 320px !important;
            border-radius: 4px !important;
            overflow: hidden !important;
          }
          [class*="CarouselThumb"]:not([class*="CarouselThumbs"]) [class*="ImageWrapper"] {
            width: 100% !important;
            height: 100% !important;
          }
          [class*="CarouselThumb"]:not([class*="CarouselThumbs"]) img {
            width: 100% !important;
            height: 100% !important;
            object-fit: cover !important;
            display: block !important;
          }
        `;

const styles = new Map<Document, HTMLStyleElement>();

/**
 * Big Picture renders through a React portal from SharedJSContext into the gamepad window (ADR-0029);
 * Steam's own GamePlaySummaryContainer draws the activity thumbnails there, and this styles them.
 * Desktop windows need nothing.
 */
export function onWindowOpened({ mode, document }: { mode: "desktop" | "gamepad"; document: Document | undefined }): void {
    if (mode !== "gamepad" || !document || styles.has(document)) return;
    if (!deps.isEnabled("captures")) return;
    try {
        const el = document.createElement("style");
        el.id = STYLE_ID;
        el.textContent = STYLE;
        document.head?.appendChild(el);
        styles.set(document, el);
    } catch (err) {
        deps.reportError("captures", err);
    }
}

export function onWindowClosed({ document }: { document: Document | undefined }): void {
    if (!document) return;
    styles.get(document)?.remove();
    styles.delete(document);
}
