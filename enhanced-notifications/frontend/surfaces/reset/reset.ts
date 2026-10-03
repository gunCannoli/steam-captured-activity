import type { ResetCandidate, ResetResult, ResetSourceOutcome } from '../../kernel/reset.ts';

/**
 * Reset Achievements decisions (pure). A Steam game is cleared one achievement at a time with Steam's own console
 * command `achievement_clear <appid> <id>`; a non-Steam game through steam-cartridges' `resetAchievements`.
 * Everything Steam-side comes in through `deps`.
 */

/** Ids go into a console command line: only plain identifier characters are ever sent. */
export const SAFE_ACHIEVEMENT_ID = /^[A-Za-z0-9_.-]{1,128}$/;

export interface AppFacts {
    appid: number;
    name: string;
    isShortcut: boolean;
}

/**
 * Is a non-Steam game offered for a reset? Only with steam-cartridges loaded, and not when it says the game's unlocks
 * cannot be reset: an Epic or Xbox copy, whose unlocks live on the store's account and come back with the next sync
 * (steam-cartridges ADR-0056). An older steam-cartridges without `achievementsResettable` keeps offering every shortcut.
 */
export function shortcutOffered(cartridges: { achievementsResettable?(appid: number): boolean } | null, appid: number): boolean {
    if (!cartridges) return false;
    try {
        return cartridges.achievementsResettable?.(appid) !== false;
    } catch {
        return true; // its answer is advice: a throw keeps today's behaviour
    }
}

/** Games with at least one unlocked achievement, sorted by name. */
export function buildCandidates(apps: readonly AppFacts[], progress: (app: AppFacts) => { unlocked: number; total: number } | undefined): ResetCandidate[] {
    const out: ResetCandidate[] = [];
    for (const app of apps) {
        const p = progress(app);
        if (!p || !(p.unlocked > 0)) continue;
        out.push({ appid: app.appid, name: app.name, unlocked: p.unlocked, total: p.total, kind: app.isShortcut ? 'shortcut' : 'steam' });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface ResetDeps {
    /** Steam's achievement list for a game; null when Steam did not answer. */
    achievements(appid: number): Promise<{ id: string; achieved: boolean }[] | null>;
    exec(command: string): void;
    /** Time for Steam to apply the commands before they are read back. */
    settle(): Promise<void>;
    /** steam-cartridges' reset, with the ids of the sources whose files are cleared too (ADR-0054). */
    resetShortcut(appid: number, sources: string[]): Promise<{ ok: boolean; sources: ResetSourceOutcome[] }>;
}

export function createReset(deps: ResetDeps): { reset(c: ResetCandidate, sources?: string[]): Promise<ResetResult> } {
    return {
        async reset(c, sources = []) {
            if (c.kind === 'shortcut') {
                const r = await deps.resetShortcut(c.appid, sources);
                return r.ok
                    ? { ok: true, cleared: c.unlocked, remaining: 0, skipped: 0, sources: r.sources }
                    : { ok: false, reason: 'steam-cartridges could not reset this game.' };
            }
            const before = await deps.achievements(c.appid);
            if (!before) return { ok: false, reason: "Steam did not return this game's achievements." };
            const unlocked = before.filter((a) => a.achieved);
            const safe = unlocked.filter((a) => SAFE_ACHIEVEMENT_ID.test(a.id));
            for (const a of safe) deps.exec(`achievement_clear ${c.appid} ${a.id}`);
            await deps.settle();
            const after = await deps.achievements(c.appid);
            return {
                ok: true,
                cleared: safe.length,
                remaining: after ? after.filter((a) => a.achieved).length : unlocked.length - safe.length,
                skipped: unlocked.length - safe.length,
            };
        },
    };
}
