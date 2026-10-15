// View sensor: the only code that detects which app page the user is looking at, and which Steam windows are open.
// Desktop: the main window's route. Big Picture: the app-details element seen through the shared jsx runtime
// (ADR-0027), counted only while a Big Picture window is open. Never writes to Steam.
import { Steam } from "steambrew-utils";
import { onLocationChange, onPopupCreate, PopupType } from "steambrew-utils/watchers";
import { watchGamepadAppid } from "../steam/gamepad-appid";
import { appIdFromPath } from "../steam/route";
import { createViewTracker, type ViewPayload } from "./view-core";

export interface ViewSensorHandlers {
    viewed(p: ViewPayload): void;
    left(p: ViewPayload): void;
    windowOpened(p: { mode: "desktop" | "gamepad"; document: Document | undefined }): void;
    windowClosed(p: { mode: "desktop" | "gamepad"; document: Document | undefined }): void;
}

let installed = false;

/**
 * Install once, after every handler is ready: onPopupCreate replays the windows already open and onLocationChange
 * reports the current route immediately. Handlers run on a timer, never synchronously: a Big Picture sighting arrives
 * from inside a jsx call, i.e. inside Steam's render, and handlers write Steam stores (guardrail 17).
 */
export function installViewSensor(h: ViewSensorHandlers): void {
    if (installed) return;
    installed = true;
    const later = <T,>(fn: (p: T) => void) => (p: T) => void setTimeout(() => fn(p), 0);

    const tracker = createViewTracker({ now: () => Date.now(), viewed: later(h.viewed), left: later(h.left) });
    const opened = later(h.windowOpened);
    const closed = later(h.windowClosed);

    let gamepadWindows = 0;
    watchGamepadAppid((appid) => {
        if (gamepadWindows > 0) tracker.sighting(appid);
    });

    onPopupCreate((popup, type) => {
        const document: Document | undefined = (popup as any)?.window?.document;
        if (type === PopupType.Desktop) {
            const stop = onLocationChange(
                () => Steam.MainWindowBrowserManager?.m_lastLocation,
                ({ pathname }) => tracker.route(appIdFromPath(pathname)),
            );
            opened({ mode: "desktop", document });
            return () => {
                stop();
                tracker.close("desktop");
                closed({ mode: "desktop", document });
            };
        }
        if (type === PopupType.Gamepad) {
            gamepadWindows++;
            opened({ mode: "gamepad", document });
            return () => {
                gamepadWindows--;
                if (gamepadWindows === 0) tracker.close("gamepad");
                closed({ mode: "gamepad", document });
            };
        }
        return undefined;
    });
}
