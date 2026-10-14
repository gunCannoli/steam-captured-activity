import React from 'react';
import { backend } from './backend';
import { ThirdPartySection } from './settings/third-party';
import { installXboxMute } from './xbox-mute';

const libraryProvider = {
    id: "steam-cartridges-third-party",
    name: "Third-Party Stores (Epic Games & Xbox)",
    async getInstalledGames() {
        try {
            const res = await backend.storeInstalledGames(true);
            const epicList = Array.isArray(res?.epic) ? res.epic : [];
            const xboxList = Array.isArray(res?.xbox) ? res.xbox : [];
            const list = [...epicList, ...xboxList];
            return list.map((g) => ({
                store: g.store,
                id: g.id,
                title: g.title,
                installPath: g.installPath || "",
                executable: g.executable || "",
                launchUri: g.launchUri,
            }));
        } catch {
            return [];
        }
    },
};

const settingsExtension = {
    id: "third-party",
    title: "Third-party",
    order: 30,
    render: () => React.createElement(ThirdPartySection, null),
};

let registered = false;
function register() {
    if (registered) return;
    registered = true;
    const api = (window as any).SteamCartridges;
    if (api && typeof api.registerLibraryProvider === 'function') {
        api.registerLibraryProvider(libraryProvider);
        api.registerSettingsPanel(settingsExtension);
        console.log('[steam-cartridges-third-party] Registered with Steam Cartridges core.');
    } else {
        (window as any).__STEAM_CARTRIDGES_QUEUE__ = (window as any).__STEAM_CARTRIDGES_QUEUE__ || [];
        (window as any).__STEAM_CARTRIDGES_QUEUE__.push({ type: 'library', provider: libraryProvider });
        (window as any).__STEAM_CARTRIDGES_QUEUE__.push({ type: 'settings', panel: settingsExtension });
        window.addEventListener('steam-cartridges:ready', ((e: CustomEvent) => {
            e.detail?.registerLibraryProvider?.(libraryProvider);
            e.detail?.registerSettingsPanel?.(settingsExtension);
        }) as EventListener, { once: true });
    }
}

export default function Entry() {
    register();
    installXboxMute();
}
