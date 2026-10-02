/** Types of the Reset Achievements feature (pure, shared by the surface and the settings panel). */

export interface ResetCandidate {
    appid: number;
    name: string;
    unlocked: number;
    total: number;
    /** `steam`: a Steam game (cleared with Steam's console); `shortcut`: a non-Steam game (listed from Steam's progress cache like any game; cleared through steam-cartridges). */
    kind: 'steam' | 'shortcut';
}

/**
 * A place a non-Steam game's unlocks come from besides Steam's list, as steam-cartridges reports it (ADR-0054):
 * `local` (Steam emulator saves), `rpcs3`, `shadps4`, `retroachievements` (never resettable: its API has no reset).
 */
export interface ResetSource {
    id: string;
    /** "local achievements (RUNE)", "RPCS3 achievements", "RetroAchievements". */
    label: string;
    resettable: boolean;
    unlocked: number;
    note?: string;
    /** A page where the user resets this source by hand (RetroAchievements: the game's page, "Manage progress"). */
    url?: string;
}

/** What a reset did to one source's files. */
export interface ResetSourceOutcome {
    id: string;
    ok: boolean;
    cleared: number;
    error?: string;
}

export type ResetResult =
    | { ok: true; cleared: number; remaining: number; skipped: number; sources?: ResetSourceOutcome[] }
    | { ok: false; reason: string };

/** What the settings panel gets injected (D7): it never imports the surface. */
export interface AchievementResetApi {
    /** false when the surface is switched off or Steam has no console command. */
    available(): boolean;
    /** Games that have at least one unlocked achievement in Steam's progress cache, sorted by name. Synchronous; call on demand, not per render. */
    candidates(): ResetCandidate[];
    /** Where a non-Steam game's unlocks also live (none for a Steam game, or without steam-cartridges' support). */
    sources(candidate: ResetCandidate): Promise<ResetSource[]>;
    /** `sources`: ids of resettable sources whose files are cleared too (each backed up first). */
    reset(candidate: ResetCandidate, sources?: string[]): Promise<ResetResult>;
    /** Opens a source's reset page in the user's browser (retroachievements.org only); false when refused. */
    openPage(url: string): boolean;
}

/** The only pages `openPage` opens: a game's page on retroachievements.org. */
export function isResetPage(url: string): boolean {
    return /^https:\/\/retroachievements\.org\/game\/\d+$/.test(url);
}

function listOf(labels: string[]): string {
    return labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * The confirm dialog's warning, from what the reset will and will not reach (ADR-0054). A Steam game is cleared on the
 * Steam account. A non-Steam game is cleared in Steam; each place its unlocks also live is either cleared too (chosen,
 * backed up), left alone (they come back the next time it is played), or out of reach (its note says where to reset).
 */
export function resetWarning(c: ResetCandidate, sources: readonly ResetSource[], chosen: ReadonlySet<string>): string {
    if (c.kind === 'steam') {
        return `${c.name} will lose all its achievements (${c.unlocked} unlocked). They are cleared on your Steam account. This cannot be undone.`;
    }
    const parts = [`${c.name} will lose its achievements in Steam (${c.unlocked} unlocked).`];
    const resettable = sources.filter((s) => s.resettable);
    const cleared = resettable.filter((s) => chosen.has(s.id));
    const kept = resettable.filter((s) => !chosen.has(s.id));
    const unreachable = sources.filter((s) => !s.resettable);
    if (!resettable.length && !unreachable.length) {
        parts.push('Only the list in Steam can be reset: no achievement files were found for this game.');
    } else if (!resettable.length) {
        parts.push(`Only the list in Steam can be reset here.`);
    }
    if (cleared.length) parts.push(`Its ${listOf(cleared.map((s) => s.label))} are cleared too, each file backed up first. Close the game before you reset.`);
    if (kept.length) parts.push(`Its ${listOf(kept.map((s) => s.label))} are kept and will come back the next time you play.`);
    for (const s of unreachable) {
        parts.push(
            s.url && chosen.has(s.id)
                ? `${s.label} cannot be reset from here: its game page opens after the reset; press Manage progress there.`
                : `${s.label}: ${s.note ?? 'cannot be reset here.'}`,
        );
    }
    for (const s of cleared) if (s.note) parts.push(`${s.label}: ${s.note}`);
    if (!cleared.length) parts.push('This cannot be undone.');
    return parts.join(' ');
}

/** Case-insensitive substring match on the name; empty text keeps everything. */
export function filterCandidates(list: readonly ResetCandidate[], text: string): ResetCandidate[] {
    const q = text.trim().toLowerCase();
    return q ? list.filter((c) => c.name.toLowerCase().includes(q)) : [...list];
}
