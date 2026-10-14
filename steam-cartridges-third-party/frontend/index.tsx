// steam-cartridges-third-party: Epic Games Store and Xbox games for Steam Cartridges (ADR-0056, ADR-0067).
// Everything about the two stores lives here: finding the copies behind shortcuts and pushing their Game Info,
// screenshots and achievements to steam-cartridges (push.ts), auto-add / remove / Xbox repairs (store-sync.ts), the
// Epic Steam Overlay Workaround (epic-launcher.ts), the Xbox notification mute (xbox-mute.ts) and the settings panel.
import React from 'react';
import { backend } from './backend';
import { ThirdPartySection } from './settings/third-party';
import { installXboxMute } from './xbox-mute';
import { installLifecycle } from './lifecycle';
import { onSettingChange, startSettings, storesOn } from './settings/current';
import { installPush, storesChanged } from './push';
import { installStoreSync, runSync } from './store-sync';
import { installEpicLauncher, refreshEpicList } from './epic-launcher';
import { logger } from './logger';

const libraryProvider = {
    id: "steam-cartridges-third-party",
    name: "Third-Party Stores (Epic Games & Xbox)",
    async getInstalledGames() {
        try {
            const res = await backend.storeInstalledGames(storesOn().xbox);
            const out: { store: "epic" | "xbox"; id: string; title: string; installPath: string; executable: string; launchUri?: string }[] = [];
            for (const store of ["epic", "xbox"] as const) {
                for (const g of Array.isArray(res?.[store]) ? res[store] : []) {
                    out.push({ store, id: g.key, title: g.title, installPath: "", executable: g.launch?.exe ?? "", launchUri: g.launch?.launch_options });
                }
            }
            return out;
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
function withCore(fn: (api: any) => void): void {
    const api = (window as any).SteamCartridges;
    if (api && typeof api.registerSettingsPanel === 'function') {
        fn(api);
        return;
    }
    window.addEventListener('steam-cartridges:ready', ((e: CustomEvent) => fn(e.detail)) as EventListener, { once: true });
}

function register(): void {
    if (registered) return;
    registered = true;
    const api = (window as any).SteamCartridges;
    if (!api || typeof api.registerSettingsPanel !== 'function') {
        // Loaded before steam-cartridges: its start-up flushes this queue.
        (window as any).__STEAM_CARTRIDGES_QUEUE__ = (window as any).__STEAM_CARTRIDGES_QUEUE__ || [];
        (window as any).__STEAM_CARTRIDGES_QUEUE__.push({ type: 'library', provider: libraryProvider });
        (window as any).__STEAM_CARTRIDGES_QUEUE__.push({ type: 'settings', panel: settingsExtension });
        return;
    }
    api.registerLibraryProvider(libraryProvider);
    api.registerSettingsPanel(settingsExtension);
    logger.info('Registered with Steam Cartridges core.');
}

async function start(): Promise<void> {
    await startSettings();
    installLifecycle();
    installXboxMute();
    installEpicLauncher();
    installStoreSync((_appid, kind) => {
        if (kind === 'epic') void refreshEpicList();
    });
    onSettingChange((key) => {
        if (key === 'autoAddEpicGames' || key === 'autoAddXboxGames') void runSync();
        if (key === 'services') storesChanged();
    });
    withCore((api) => installPush(api));
}

export default function Entry() {
    register();
    void start().catch((err) => logger.error('start-up failed:', err));
}
