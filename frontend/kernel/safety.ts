// Safety net: every part that writes into Steam runs behind its own switch. A part whose hook throws more than its
// budget is switched off for the session and Steam's own behaviour comes back (fail-open, as steam-cartridges'
// safety/features.ts). Pure: tests load it with node.

/** Stable ids, one per part that writes into Steam. */
export const PART_IDS = ["feed", "store-stub", "sections", "headline", "cards", "bpm-style"] as const;
export type PartId = (typeof PART_IDS)[number];

export interface Safety {
    isEnabled(id: PartId): boolean;
    /** Count an error against a part (fail-open catch blocks); past the budget the part is off until Steam restarts. */
    reportError(id: PartId, err: unknown): void;
    diagnostics(): { tripped: PartId[]; errors: Partial<Record<PartId, number>> };
}

export function createSafety(opts: { budget?: number; log?: (message: string, err: unknown) => void } = {}): Safety {
    const budget = opts.budget ?? 20;
    const errors = new Map<PartId, number>();
    const tripped = new Set<PartId>();
    return {
        isEnabled: (id) => !tripped.has(id),
        reportError(id, err) {
            const n = (errors.get(id) ?? 0) + 1;
            errors.set(id, n);
            opts.log?.(`Part "${id}" failed (${n}/${budget}).`, err);
            if (n >= budget && !tripped.has(id)) {
                tripped.add(id);
                opts.log?.(`Part "${id}" switched off for this session after ${n} errors.`, err);
            }
        },
        diagnostics: () => ({ tripped: [...tripped], errors: Object.fromEntries(errors) }),
    };
}
