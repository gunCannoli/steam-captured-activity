// Kernel: Extension / Expansion Provider API (Phase 9 & ADR-0012/ADR-0013/ADR-0014).
// Allows external plugins (steam-cartridges-local, steam-cartridges-third-party, etc.)
// to contribute achievements, game installations, settings tabs, and summary evidence
// to steam-cartridges without tight coupling or host crashes.

export interface AppContext {
    appid: number;
    gameid: string;
    isShortcut: boolean;
    displayName: string;
    exe?: string;
    launchOptions?: string;
    /** The Steam app this shortcut maps to (0 or absent = none). Extensions never read the core's files for it (ADR-0063). */
    nativeAppid?: number;
    /** The ids of the record's achievement schema, when it has one (lets a provider decode CRC-keyed files). */
    achievementIds?: string[];
}

export interface ReportUnlocksOptions {
    /** The reporting provider's id, for the log. */
    providerId: string;
    /** true: record and show in the Post-Game Summary, no toast (a first snapshot of old unlocks). */
    silent?: boolean;
}

export interface AchievementSchemaItem {
    id: string;
    name: string;
    description: string;
    icon: string;
    unlockedIcon?: string;
    hidden?: boolean;
}

export interface AchievementUnlockItem {
    id: string;
    unlockedAt: number; // unix timestamp
}

export interface AchievementSourceProvider {
    id: string;
    name: string;
    priority?: number;
    match(context: AppContext): Promise<boolean> | boolean;
    getSchema?(context: AppContext): Promise<AchievementSchemaItem[] | null>;
    getUnlocks(context: AppContext): Promise<AchievementUnlockItem[]>;
    reset?(context: AppContext): Promise<{ cleared: number; ok: boolean; backupPath?: string }>;
}

export interface InstalledGame {
    store: "epic" | "xbox" | string;
    id: string;
    title: string;
    installPath: string;
    executable: string;
    launchUri?: string;
    iconUrl?: string;
}

export interface LibrarySourceProvider {
    id: string;
    name: string;
    getInstalledGames(): Promise<InstalledGame[]>;
    onBeforeLaunch?(context: AppContext): Promise<{ cancel?: boolean }>;
    onAfterQuit?(context: AppContext): Promise<void>;
}

export interface SettingsPanelExtension {
    id: string;
    title: string;
    order?: number;
    render: () => any;
}

export interface SummaryContribution {
    text: string;
    icon?: string;
    timestamp?: number;
}

export interface SummaryProvider {
    id: string;
    name: string;
    getContributions?(context: AppContext): Promise<SummaryContribution[]>;
}

export interface SteamCartridgesAPI {
    readonly version: string;
    registerAchievementProvider(provider: AchievementSourceProvider): () => void;
    registerLibraryProvider(provider: LibrarySourceProvider): () => void;
    registerSettingsPanel(panel: SettingsPanelExtension): () => void;
    registerSummaryProvider(provider: SummaryProvider): () => void;
    getAchievementProviders(): AchievementSourceProvider[];
    getLibraryProviders(): LibrarySourceProvider[];
    getSettingsPanels(): SettingsPanelExtension[];
    onAppViewed(cb: (context: AppContext) => void): () => void;
    onAppLaunched(cb: (context: AppContext) => void): () => void;
    onAppQuit(cb: (context: AppContext) => void): () => void;
    notifyAppViewed(context: AppContext): void;
    notifyAppLaunched(context: AppContext): void;
    notifyAppQuit(context: AppContext): void;
    /** Extensions push unlocks; the core canonicalizes, persists and announces them (ADR-0063). */
    reportUnlocks(appid: number, unlocks: AchievementUnlockItem[], opts: ReportUnlocksOptions): Promise<{ accepted: string[] }>;
}

export function createExtensionRegistry(
    sink: { reportUnlocks: SteamCartridgesAPI["reportUnlocks"] } = { reportUnlocks: async () => ({ accepted: [] }) },
): SteamCartridgesAPI {
    const achievementProviders: AchievementSourceProvider[] = [];
    const libraryProviders: LibrarySourceProvider[] = [];
    const settingsPanels: SettingsPanelExtension[] = [];
    const summaryProviders: SummaryProvider[] = [];
    const viewListeners: ((context: AppContext) => void)[] = [];
    const launchListeners: ((context: AppContext) => void)[] = [];
    const quitListeners: ((context: AppContext) => void)[] = [];

    const api: SteamCartridgesAPI = {
        version: "1.1.0",
        registerAchievementProvider(provider) {
            const existing = achievementProviders.findIndex((p) => p.id === provider.id);
            if (existing >= 0) achievementProviders.splice(existing, 1);
            achievementProviders.push(provider);
            achievementProviders.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
            return () => {
                const idx = achievementProviders.indexOf(provider);
                if (idx >= 0) achievementProviders.splice(idx, 1);
            };
        },
        registerLibraryProvider(provider) {
            const existing = libraryProviders.findIndex((p) => p.id === provider.id);
            if (existing >= 0) libraryProviders.splice(existing, 1);
            libraryProviders.push(provider);
            return () => {
                const idx = libraryProviders.indexOf(provider);
                if (idx >= 0) libraryProviders.splice(idx, 1);
            };
        },
        registerSettingsPanel(panel) {
            const existing = settingsPanels.findIndex((p) => p.id === panel.id);
            if (existing >= 0) settingsPanels.splice(existing, 1);
            settingsPanels.push(panel);
            settingsPanels.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
            return () => {
                const idx = settingsPanels.indexOf(panel);
                if (idx >= 0) settingsPanels.splice(idx, 1);
            };
        },
        registerSummaryProvider(provider) {
            const existing = summaryProviders.findIndex((p) => p.id === provider.id);
            if (existing >= 0) summaryProviders.splice(existing, 1);
            summaryProviders.push(provider);
            return () => {
                const idx = summaryProviders.indexOf(provider);
                if (idx >= 0) summaryProviders.splice(idx, 1);
            };
        },
        getAchievementProviders: () => achievementProviders.slice(),
        getLibraryProviders: () => libraryProviders.slice(),
        getSettingsPanels: () => settingsPanels.slice(),
        onAppViewed(cb) {
            viewListeners.push(cb);
            return () => {
                const idx = viewListeners.indexOf(cb);
                if (idx >= 0) viewListeners.splice(idx, 1);
            };
        },
        onAppLaunched(cb) {
            launchListeners.push(cb);
            return () => {
                const idx = launchListeners.indexOf(cb);
                if (idx >= 0) launchListeners.splice(idx, 1);
            };
        },
        onAppQuit(cb) {
            quitListeners.push(cb);
            return () => {
                const idx = quitListeners.indexOf(cb);
                if (idx >= 0) quitListeners.splice(idx, 1);
            };
        },
        notifyAppViewed(ctx) {
            for (const cb of viewListeners) {
                try {
                    cb(ctx);
                } catch {
                    // Fail-silent isolation (ADR-0014)
                }
            }
        },
        notifyAppLaunched(ctx) {
            for (const cb of launchListeners) {
                try {
                    cb(ctx);
                } catch {
                    // Fail-silent isolation (ADR-0014)
                }
            }
        },
        reportUnlocks(appid, unlocks, opts) {
            try {
                return sink.reportUnlocks(appid, Array.isArray(unlocks) ? unlocks : [], opts).catch(() => ({ accepted: [] }));
            } catch {
                return Promise.resolve({ accepted: [] });
            }
        },
        notifyAppQuit(ctx) {
            for (const cb of quitListeners) {
                try {
                    cb(ctx);
                } catch {
                    // Fail-silent isolation (ADR-0014)
                }
            }
        },
    };

    return api;
}
