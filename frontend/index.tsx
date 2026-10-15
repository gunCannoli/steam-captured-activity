// Composition root: creates and wires everything; no logic of its own.
//   sensors (view, lifecycle, captures)  ->  app/publisher  ->  surfaces (feed, store-stub, sections, headline, cards, bpm-style)
// Only surfaces write to Steam. Works alone: it needs nothing from steam-cartridges, and next to it each plugin keeps
// its own events in the same feed (surfaces/feed.ts).
import { definePlugin, IconsModule } from "@steambrew/client";
import { logger } from "./logger";
import { clipGameId, isShortcutAppId } from "./kernel/appid";
import { createSafety } from "./kernel/safety";
import { localMidnight } from "./domain/captures";
import { createPublisher, SWEEP_MS, SWEEP_NO_EVENTS_MS } from "./app/publisher";
import { clipsOf, screenshotsOf } from "./steam/stores";
import { installViewSensor } from "./sensors/view";
import { installLifecycleSensor } from "./sensors/lifecycle";
import { installCaptureSensor } from "./sensors/captures";
import { setSafety } from "./surfaces/context";
import { clear, feedDiagnostics, hasCaptures, needsRepair, publish } from "./surfaces/feed";
import { installSectionsPatch, refreshSections } from "./surfaces/sections";
import { headlineJsxDiagnostics, installHeadlinePatch } from "./surfaces/headline";
import { cardsJsxDiagnostics, installActivityCardsPatch } from "./surfaces/cards";
import { onWindowClosed, onWindowOpened } from "./surfaces/bpm-style";
import { initSettings, onSettingChange, resetSettings, setSetting, setting } from "./settings/settings";
import { SettingsPanel } from "./settings/panel";

const safety = createSafety({ log: (message, err) => logger.warn(message, err) });
setSafety(safety);

const publisher = createPublisher({
    scope: () => ({ steamGames: setting("steamGames"), nonSteamGames: setting("nonSteamGames") }),
    readCaptures: async (appid) => {
        const [screenshots, clips] = await Promise.all([screenshotsOf(appid), clipsOf(clipGameId(appid))]);
        return { screenshots, clips };
    },
    publish,
    clear,
    needsRepair,
    contentChanged: (appid) => {
        if (isShortcutAppId(appid)) refreshSections();
    },
    dayOf: localMidnight,
    every: (ms, fn) => {
        const id = setInterval(fn, ms);
        return () => clearInterval(id);
    },
    after: (ms, fn) => void setTimeout(fn, ms),
    log: (message) => logger.info(message),
});

/** The last capture events Steam sent (sensors/captures), for CDP checks. */
const captureEventLog: Array<{ at: number; appid: number; what: string }> = [];
let captureEventsLive = 0;

/** For CDP checks (window.PLUGIN_LIST[...]): what the plugin holds, and a sweep on demand. */
export const diagnostics = () => ({
    feed: feedDiagnostics(),
    tracked: publisher.tracked(),
    safety: safety.diagnostics(),
    captureEvents: { live: captureEventsLive, recent: [...captureEventLog] },
});
export const sweepNow = () => publisher.sweep();
export { setSetting, resetSettings, headlineJsxDiagnostics, cardsJsxDiagnostics };

/** Run one install under its part's switch; a failure costs that part only. */
function install(id: Parameters<typeof safety.reportError>[0], fn: () => unknown): void {
    try {
        fn();
    } catch (err) {
        safety.reportError(id, err);
    }
}

async function init(): Promise<void> {
    await initSettings();
    onSettingChange(() => void publisher.scopeChanged());

    install("sections", () => installSectionsPatch(hasCaptures));
    install("headline", installHeadlinePatch);
    install("cards", installActivityCardsPatch);

    // Sensors last: they report the current page and the windows already open immediately.
    installViewSensor({
        viewed: ({ appid }) => void publisher.viewed(appid),
        left: () => {
            /* the feed stays: Steam's store is global, and the sweep keeps it true */
        },
        windowOpened: onWindowOpened,
        windowClosed: onWindowClosed,
    });
    installLifecycleSensor((appid) => void publisher.quit(appid));
    // Steam's own capture events drive the clean-up; the sweep is the fallback (slower while they are live).
    const live = installCaptureSensor((appid, what) => {
        captureEventLog.push({ at: Date.now(), appid, what });
        if (captureEventLog.length > 20) captureEventLog.shift();
        publisher.changed(appid);
    });
    captureEventsLive = live;
    if (live < 3) logger.warn(`Only ${live} of Steam's 3 capture events are available; the sweep runs every ${SWEEP_NO_EVENTS_MS / 60000} min.`);
    publisher.start(live === 3 ? SWEEP_MS : SWEEP_NO_EVENTS_MS);
    logger.info("Ready. Captures show in the Activity feed of every game in scope.");
}

export default definePlugin(() => {
    init().catch((e) => logger.error("Plugin init failed.", e));

    // Guardrail 16: the settings panel and plugin list resolve under both the released and the -dev name.
    setTimeout(() => {
        try {
            for (const key of ["MILLENNIUM_SIDEBAR_NAVIGATION_PANELS", "PLUGIN_LIST"]) {
                const map = (window as any)[key];
                if (!map) continue;
                const a = "steam-captured-activity";
                const b = "steam-captured-activity-dev";
                if (map[a] && !map[b]) map[b] = map[a];
                if (map[b] && !map[a]) map[a] = map[b];
            }
        } catch {
            /* ignore */
        }
    }, 0);

    return {
        title: "Steam Captured Activity",
        icon: <IconsModule.Settings />,
        content: <SettingsPanel />,
    };
});
