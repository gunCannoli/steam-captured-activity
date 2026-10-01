/**
 * Kernel: the Surface contract and its install runner (migration plan § 4.4).
 * A surface is the only kind of code that writes into Steam. Pure.
 */

export interface Surface {
    /** Stable id; also its kill switch (a FeatureId in safety/features.ts). */
    id: string;
    /** Steam targets this surface writes (§ 4.3). No two surfaces share one. */
    touches: readonly string[];
    /** Resolve and patch once. false = Steam lacks what it needs: the surface stays off, not an error. */
    install(): boolean;
    /** Undo every patch. Idempotent. Called when the feature trips its error budget. */
    uninstall(): void;
}

export interface SurfaceStatus {
    id: string;
    installed: boolean;
    skipped: 'disabled' | 'unavailable' | 'failed' | null;
}

/** Throws `Steam target "<t>" is touched by both "<a>" and "<b>"` on a shared target. */
export function assertDisjointTouches(surfaces: readonly Pick<Surface, 'id' | 'touches'>[]): void {
    const owner = new Map<string, string>();
    for (const s of surfaces) {
        for (const t of s.touches) {
            const prev = owner.get(t);
            if (prev !== undefined && prev !== s.id) throw new Error(`Steam target "${t}" is touched by both "${prev}" and "${s.id}"`);
            owner.set(t, s.id);
        }
    }
}

/** assertDisjointTouches first (throws before installing anything), then each surface in order, each in its own
 *  try/catch: disabled → skipped 'disabled'; install() false → 'unavailable'; throws → reportError(id) and 'failed'. */
export function installSurfaces(
    surfaces: readonly Surface[],
    deps: { isEnabled(id: string): boolean; reportError(id: string, err: unknown): void },
): SurfaceStatus[] {
    assertDisjointTouches(surfaces);
    return surfaces.map((s): SurfaceStatus => {
        if (!deps.isEnabled(s.id)) return { id: s.id, installed: false, skipped: 'disabled' };
        try {
            return s.install() ? { id: s.id, installed: true, skipped: null } : { id: s.id, installed: false, skipped: 'unavailable' };
        } catch (err) {
            try {
                deps.reportError(s.id, err);
            } catch {
                /* reporting must never break the rest of the install */
            }
            return { id: s.id, installed: false, skipped: 'failed' };
        }
    });
}
