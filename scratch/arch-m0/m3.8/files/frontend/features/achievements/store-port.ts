// The achievements surface as the features see it (migration plan M3.5, § 7.0 D3): wired in
// index.tsx to surfaces/achievements, no-ops until then.
// PURGE(M6): delete when M6 moves the achievements pipeline to the backend. Ledger: migration plan § 7.9.
import type { AchievementSchemaRecord, AchievementUnlockRecord } from "../../rpc";
import type { SteamAppAchievements } from "../../steam/achievement-types";

let store: {
    hook(): boolean;
    getLocalAchievements(shortcutAppId: number): SteamAppAchievements | undefined;
    getLocalSchema(nativeAppId: number): AchievementSchemaRecord | undefined;
    getLocalUnlocks(shortcutAppId: number): Record<string, AchievementUnlockRecord> | undefined;
    updateShortcutState(
        shortcutAppId: number,
        nativeAppId: number,
        schema: AchievementSchemaRecord | undefined,
        unlocks?: Record<string, AchievementUnlockRecord>,
    ): SteamAppAchievements | null;
} = {
    hook: () => false,
    getLocalAchievements: () => undefined,
    getLocalSchema: () => undefined,
    getLocalUnlocks: () => undefined,
    updateShortcutState: () => null,
};

export function setAchievementsStore(next: typeof store): void {
    store = next;
}

export const ensureAchievementsStoreHooked = () => store.hook();
export const getLocalAchievements = (shortcutAppId: number) => store.getLocalAchievements(shortcutAppId);
export const getLocalSchema = (nativeAppId: number) => store.getLocalSchema(nativeAppId);
export const getLocalUnlocks = (shortcutAppId: number) => store.getLocalUnlocks(shortcutAppId);
export const updateShortcutState = (
    shortcutAppId: number,
    nativeAppId: number,
    schema: AchievementSchemaRecord | undefined,
    unlocks: Record<string, AchievementUnlockRecord> = {},
) => store.updateShortcutState(shortcutAppId, nativeAppId, schema, unlocks);
