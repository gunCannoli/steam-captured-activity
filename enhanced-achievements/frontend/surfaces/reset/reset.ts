import type { ResetCandidate, ResetResult } from '../../kernel/reset.ts';

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
    resetShortcut(appid: number): Promise<boolean>;
}

export function createReset(deps: ResetDeps): { reset(c: ResetCandidate): Promise<ResetResult> } {
    return {
        async reset(c) {
            if (c.kind === 'shortcut') {
                return (await deps.resetShortcut(c.appid))
                    ? { ok: true, cleared: c.unlocked, remaining: 0, skipped: 0 }
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
