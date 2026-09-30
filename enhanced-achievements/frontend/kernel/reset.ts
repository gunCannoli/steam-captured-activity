/** Types of the Reset Achievements feature (pure, shared by the surface and the settings panel). */

export interface ResetCandidate {
    appid: number;
    name: string;
    unlocked: number;
    total: number;
    /** `steam`: a Steam game (cleared with Steam's console); `shortcut`: a non-Steam game (listed from Steam's progress cache like any game; cleared through steam-cartridges). */
    kind: 'steam' | 'shortcut';
}

export type ResetResult = { ok: true; cleared: number; remaining: number; skipped: number } | { ok: false; reason: string };

/** What the settings panel gets injected (D7): it never imports the surface. */
export interface AchievementResetApi {
    /** false when the surface is switched off or Steam has no console command. */
    available(): boolean;
    /** Games that have at least one unlocked achievement in Steam's progress cache, sorted by name. Synchronous; call on demand, not per render. */
    candidates(): ResetCandidate[];
    reset(candidate: ResetCandidate): Promise<ResetResult>;
}

/** Case-insensitive substring match on the name; empty text keeps everything. */
export function filterCandidates(list: readonly ResetCandidate[], text: string): ResetCandidate[] {
    const q = text.trim().toLowerCase();
    return q ? list.filter((c) => c.name.toLowerCase().includes(q)) : [...list];
}
