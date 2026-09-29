// Surface `captures`: Big Picture activity thumbnail styling (migration plan M3.2).
// Moved verbatim from index.tsx; a <style> element in the gamepad popup is a Steam write.
import { onPopupCreate, PopupType } from "steambrew-utils/watchers";
import { deps } from "./deps";

let installed = false;

export function installBpmStyle(): void {
    if (installed) return;
    installed = true;
    onPopupCreate((popup, type) => {
        if (!deps.isEnabled("captures")) return undefined;
        if (type === PopupType.Gamepad) {
            // Big Picture renders through a React portal from SharedJSContext
            // into the gamepad popup window (ADR-0029). Both UI modes share the
            // same store singletons, webpack chunks, and CAppDetailsSections registry.
            //
            // Because Ge.T (module 53074) is already built into Big Picture's
            // "ACTIVITY" tab, feeding appSpotlightStore via patchLibraryApp(appid)
            // makes Steam render its genuine native GamePlaySummaryContainer with
            // controller focus rings and carousel scrolling automatically.

            // Inject scoped BPM activity feed thumbnail styling into the gamepad popup document
            const doc = popup.window?.document;
            let styleEl: HTMLStyleElement | null = doc
                ? doc.createElement("style")
                : null;
            if (styleEl && doc) {
                styleEl.id = "nsga-bpm-activity-thumbs";
                styleEl.textContent = `
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
                doc.head?.appendChild(styleEl);
            }

            return () => {
                if (styleEl && styleEl.parentNode) {
                    styleEl.parentNode.removeChild(styleEl);
                }
            };
        }

        // Desktop, Modal, ContextMenu, Unknown: no styling needed.
        return undefined;
    });
}
