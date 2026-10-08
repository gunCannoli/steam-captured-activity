// steam-cartridges-local: Steam API emulator achievement files and engine logs for steam-cartridges (ADR-0063).
// The provider serves the Reset dialog; the observer pushes unlocks as they are found.
import React from "react";
import { asList, callLocalBackend, unlocksOf, type AppContext, type LocalFile } from "./backend";
import { installObserver } from "./observer";
import { LocalSection } from "./settings/panel";

/** The label found at the last match: the Reset dialog names the source after it (it calls match, then reads name). */
let lastLabel = "Local achievements";

const localProvider = {
    id: "steam-cartridges-local",
    get name() {
        return lastLabel;
    },
    priority: 15,
    async match(ctx: AppContext): Promise<boolean> {
        if (!ctx?.isShortcut) return false;
        const res = await callLocalBackend<{ files?: unknown }>("LocalDetectFiles", ctx);
        const files = asList<LocalFile>(res?.files);
        if (files.length === 0) return false;
        const names = [...new Set(files.map((f) => f?.label).filter((l): l is string => typeof l === "string" && l.length > 0))];
        lastLabel = names.length > 0 ? `Local achievements (${names.join(", ")})` : "Local achievements";
        return true;
    },
    async getUnlocks(ctx: AppContext) {
        return unlocksOf(await callLocalBackend<{ unlocks?: unknown }>("LocalReadUnlocks", ctx));
    },
    async reset(ctx: AppContext): Promise<{ cleared: number; ok: boolean; backupPath?: string }> {
        const res = await callLocalBackend<{ ok?: boolean; cleared?: number; backupPath?: string }>("LocalResetUnlocks", ctx);
        return { ok: res?.ok ?? false, cleared: Number(res?.cleared) || 0, backupPath: res?.backupPath };
    },
};

const settingsExtension = {
    id: "steam-cartridges-local",
    title: "Local achievements",
    order: 40,
    render: () => React.createElement(LocalSection, null),
};

let observerTried = false;

function observe(api: any) {
    if (observerTried) return;
    observerTried = true;
    installObserver(api);
}

export default function Entry() {
    const w = window as any;
    const api = w.SteamCartridges;
    if (api && typeof api.registerAchievementProvider === "function") {
        api.registerAchievementProvider(localProvider);
        api.registerSettingsPanel?.(settingsExtension);
        observe(api);
        console.log("[steam-cartridges-local] Registered with Steam Cartridges core.");
        return;
    }
    // steam-cartridges loads later: queue the provider and the panel (it flushes the queue at start), and attach the
    // observer once its API exists.
    w.__STEAM_CARTRIDGES_QUEUE__ = w.__STEAM_CARTRIDGES_QUEUE__ || [];
    w.__STEAM_CARTRIDGES_QUEUE__.push({ type: "achievement", provider: localProvider });
    w.__STEAM_CARTRIDGES_QUEUE__.push({ type: "settings", panel: settingsExtension });
    let tries = 0;
    const timer = setInterval(() => {
        tries++;
        if (w.SteamCartridges?.version) {
            clearInterval(timer);
            observe(w.SteamCartridges);
        } else if (tries >= 120) {
            clearInterval(timer);
        }
    }, 1000);
}
