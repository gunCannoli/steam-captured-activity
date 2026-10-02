import type { Surface } from '../../kernel/surface';
import { isResetPage, type AchievementResetApi, type ResetResult, type ResetSource, type ResetSourceOutcome } from '../../kernel/reset';
import { progressFor } from '../../steam/notification-store';
import { isEnabled, reportError } from '../../safety/runtime';
import { buildCandidates, createReset, type AppFacts } from './reset';

/** Steam's app type for a non-Steam shortcut (AppOverview.app_type). */
const SHORTCUT_APP_TYPE = 1073741824;
const SETTLE_MS = 1500;

interface SteamConsole {
    ExecCommand(command: string): void;
}
interface AppOverviewLike {
    appid: number;
    display_name: string;
    app_type: number;
}
interface Cartridges {
    resetAchievements(appid: number): Promise<boolean>;
    /** Newer steam-cartridges (ADR-0054): where a shortcut's unlocks also live, and a reset that clears them too. */
    achievementResetSources?(appid: number): Promise<ResetSource[]>;
    resetAchievementsWithSources?(appid: number, sources: string[]): Promise<{ ok: boolean; sources: ResetSourceOutcome[] }>;
}

const steamConsole = (): SteamConsole | undefined => Reflect.get(globalThis, 'SteamClient')?.Console;

/**
 * steam-cartridges' public API (its `resetAchievements`, D8 there), found through Millennium's plugin list. A soft link:
 * plugins never import each other, and without it non-Steam games are simply not offered. The `-dev` copy wins when both are loaded.
 */
function cartridges(): Cartridges | null {
    const list = Reflect.get(globalThis, 'PLUGIN_LIST') as Record<string, Partial<Cartridges> | undefined> | undefined;
    for (const name of ['steam-cartridges-dev', 'steam-cartridges']) {
        const p = list?.[name];
        if (typeof p?.resetAchievements === 'function') return p as Cartridges;
    }
    return null;
}

function libraryApps(): AppFacts[] {
    const apps = (Reflect.get(globalThis, 'appStore')?.allApps ?? []) as AppOverviewLike[];
    return apps.map((a) => ({ appid: a.appid, name: a.display_name, isShortcut: a.app_type === SHORTCUT_APP_TYPE }));
}

async function steamAchievements(appid: number): Promise<{ id: string; achieved: boolean }[] | null> {
    try {
        // Steam wants the appid as a string here; a number resolves to undefined.
        const r = await Reflect.get(globalThis, 'SteamClient')?.Apps?.GetMyAchievementsForApp(String(appid));
        const list = r?.data?.rgAchievements as { strID: string; bAchieved: boolean }[] | undefined;
        return list ? list.map((a) => ({ id: a.strID, achieved: !!a.bAchieved })) : null;
    } catch {
        return null;
    }
}

const engine = createReset({
    achievements: steamAchievements,
    exec: (command) => steamConsole()?.ExecCommand(command),
    settle: () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS)),
    async resetShortcut(appid, sources) {
        const c = cartridges();
        if (!c) return { ok: false, sources: [] };
        // An older steam-cartridges has no source files to clear: its plain reset.
        if (typeof c.resetAchievementsWithSources !== 'function') return { ok: (await c.resetAchievements(appid)) === true, sources: [] };
        return await c.resetAchievementsWithSources(appid, sources);
    },
});

/** Handed to the settings panel by index.tsx (D7). Fail-open: an error is counted and reported to the user, never thrown. */
export const achievementReset: AchievementResetApi = {
    available: () => isEnabled('reset') && typeof steamConsole()?.ExecCommand === 'function',
    candidates() {
        try {
            // Every game from Steam's own progress cache: steam-cartridges fills it for its shortcuts at start-up, as
            // Steam does for an owned game (ADR-0045). A shortcut is offered only when steam-cartridges can reset it.
            const shortcutsResettable = cartridges() !== null;
            return buildCandidates(libraryApps(), (app) => {
                if (app.isShortcut && !shortcutsResettable) return undefined;
                const p = progressFor(app.appid);
                return typeof p?.unlocked === 'number' ? { unlocked: p.unlocked, total: Number(p.total) || 0 } : undefined;
            });
        } catch (error) {
            reportError('reset', error);
            return [];
        }
    },
    async sources(candidate): Promise<ResetSource[]> {
        if (candidate.kind !== 'shortcut') return [];
        try {
            const list = await cartridges()?.achievementResetSources?.(candidate.appid);
            return Array.isArray(list) ? list : [];
        } catch (error) {
            reportError('reset', error);
            return [];
        }
    },
    openPage(url) {
        if (!isEnabled('reset') || !isResetPage(url)) return false;
        try {
            Reflect.get(globalThis, 'SteamClient')?.System?.OpenInSystemBrowser(url);
            return true;
        } catch (error) {
            reportError('reset', error);
            return false;
        }
    },
    async reset(candidate, sources = []): Promise<ResetResult> {
        if (!achievementReset.available()) return { ok: false, reason: 'Reset Achievements is switched off.' };
        try {
            return await engine.reset(candidate, sources);
        } catch (error) {
            reportError('reset', error);
            return { ok: false, reason: 'Something went wrong; see the log.' };
        }
    },
};

/** Clears achievements through Steam's console (and steam-cartridges for non-Steam games). Patches nothing. */
export function createResetSurface(): Surface {
    return {
        id: 'reset',
        touches: ['SteamClient.Console.ExecCommand', 'steam-cartridges.resetAchievements', 'SteamClient.System.OpenInSystemBrowser'],
        install: () => typeof steamConsole()?.ExecCommand === 'function',
        uninstall() {},
    };
}
