// View sensor (migration plan M2, ADR-0039): the only code that detects which shortcut
// page the user is looking at. Desktop: the main window's route. Big Picture: the
// app-details element seen through the shared jsx runtime (ADR-0027), counted only while
// a Big Picture window is open. Emits shortcut.viewed / shortcut.left, and window.opened /
// window.closed for the desktop and Big Picture windows, on the bus.
import { Steam } from "steambrew-utils";
import { onLocationChange, onPopupCreate, PopupType } from "steambrew-utils/watchers";
import { logger } from "../../logger";
import { toShortcutId } from "../../kernel/appid";
import type { EventBus } from "../../kernel/events";
import { watchGamepadAppid } from "../../steam/gamepad-appid";
import { appIdFromPath } from "../../steam/route";
import { createViewTracker } from "./core";

let installed = false;

/**
 * Install once, after every subscriber is registered: onPopupCreate replays the windows
 * already open and onLocationChange reports the current route immediately.
 */
export function installViewSensor(bus: EventBus): void {
    if (installed) return;
    installed = true;

    // Emit on a timer, never synchronously: a Big Picture sighting arrives from inside a jsx
    // call, i.e. inside Steam's render, and handlers write Steam stores (guardrail 17).
    // Timers keep the order of the signals.
    const tracker = createViewTracker({
        toShortcutId,
        now: () => Date.now(),
        viewed: (p) =>
            setTimeout(() => {
                logger.info(`Viewed shortcut ${p.appid} (${p.mode}).`);
                bus.emit("shortcut.viewed", p);
            }, 0),
        left: (p) =>
            setTimeout(() => {
                logger.info(`Left shortcut ${p.appid} (${p.mode}).`);
                bus.emit("shortcut.left", p);
            }, 0),
        nativeViewed: (p) =>
            setTimeout(() => {
                logger.info(`Viewed native app ${p.appid} (${p.mode}).`);
                bus.emit("native.viewed", p);
            }, 0),
        nativeLeft: (p) =>
            setTimeout(() => {
                logger.info(`Left native app ${p.appid} (${p.mode}).`);
                bus.emit("native.left", p);
            }, 0),
    });

    let gamepadWindows = 0;
    watchGamepadAppid((appid) => {
        if (gamepadWindows > 0) tracker.sighting(appid);
    });

    // Window lifecycle for surfaces that write into a window's own document (captures' Big Picture style).
    const windowEvent = (event: "window.opened" | "window.closed", mode: "desktop" | "gamepad", document: Document | undefined) =>
        setTimeout(() => bus.emit(event, { mode, document }), 0);

    onPopupCreate((popup, type) => {
        const document: Document | undefined = (popup as any)?.window?.document;
        if (type === PopupType.Desktop) {
            const stop = onLocationChange(
                () => Steam.MainWindowBrowserManager?.m_lastLocation,
                ({ pathname }) => tracker.route(appIdFromPath(pathname)),
            );
            windowEvent("window.opened", "desktop", document);
            return () => {
                stop();
                tracker.close("desktop");
                windowEvent("window.closed", "desktop", document);
            };
        }
        if (type === PopupType.Gamepad) {
            gamepadWindows++;
            windowEvent("window.opened", "gamepad", document);
            return () => {
                gamepadWindows--;
                if (gamepadWindows === 0) tracker.close("gamepad");
                windowEvent("window.closed", "gamepad", document);
            };
        }
        return undefined;
    });
}
