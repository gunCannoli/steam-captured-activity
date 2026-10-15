// Lifecycle sensor: the only code that detects a game quitting (Steam games and shortcuts alike). Quitting is when
// new screenshots and clips exist, so the feed re-reads them then (ADR-0007: refresh on an event, not by polling).
import { onAppLaunch } from "steambrew-utils/watchers";
import { toUnsigned } from "../kernel/appid";

let installed = false;

export function installLifecycleSensor(onQuit: (appid: number) => void): void {
    if (installed) return;
    installed = true;
    onAppLaunch((app, { onQuit: whenQuit }) => {
        const appid = toUnsigned(app.appid);
        if (appid === undefined) return;
        whenQuit(() => onQuit(appid));
    });
}
