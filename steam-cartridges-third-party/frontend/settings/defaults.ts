// The settings and their defaults (no imports, so current.ts and settings.ts can both use them).
export interface ThirdPartySettings {
    services: { epicEnabled: boolean; xboxEnabled: boolean };
    autoAddEpicGames: boolean;
    autoAddXboxGames: boolean;
    epicOverlayWorkaround: boolean;
    muteXboxNotifications: boolean;
}

export const DEFAULTS: ThirdPartySettings = {
    services: { epicEnabled: true, xboxEnabled: true },
    autoAddEpicGames: false,
    autoAddXboxGames: false,
    epicOverlayWorkaround: false,
    muteXboxNotifications: false,
};
