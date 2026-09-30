/**
 * Kill switches and error budget (docs/plans/enhanced-achievements-architecture-migration-plan.md
 * § E0a). Same design as steam-cartridges/frontend/safety/features.ts; plugins may not
 * import each other, so this is a copy with this plugin's feature ids.
 *
 * Every part of the plugin that writes into Steam has a FeatureId. A feature runs only
 * while it is enabled; one that throws `errorBudget` times is switched off until Steam
 * restarts, and Steam's stock behaviour returns for it. The user switches features off
 * with the `disabledFeatures` setting (comma-separated ids), e.g. from the
 * SharedJSContext console:
 *   PLUGIN_LIST['enhanced-achievements-dev'].setSetting('disabledFeatures', 'banner,sound')
 *
 * Pure: no Steam, SDK or logger import (tests/safety.test.ts).
 */

/** Stable ids: users type them. Never rename one; add new ones at the end. */
export const FEATURE_IDS = ['banner', 'sound', 'duration', 'completion', 'captures'] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];

/** Safe mode keeps nothing: every achievement toast is Steam's own. */
export const SAFE_MODE_FEATURES: ReadonlySet<FeatureId> = new Set<FeatureId>();

export interface FeatureSwitches {
    isEnabled(id: FeatureId): boolean;
    /** Run a feature's code if it is enabled. Never throws; returns undefined when skipped or failed. */
    run<T>(id: FeatureId, fn: () => T): T | undefined;
    /** Count an error against a feature (for fail-open catch blocks). */
    reportError(id: FeatureId, err: unknown): void;
    setSafeMode(on: boolean): void;
    /** Re-read the `disabledFeatures` setting (call on its change). */
    reload(): void;
    errorCount(): number;
    diagnostics(): {
        safeMode: boolean;
        disabled: string[];
        tripped: string[];
        errors: Record<string, number>;
    };
}

export interface FeatureSwitchOptions {
    /** Current value of the `disabledFeatures` setting. */
    readDisabled: () => string;
    errorBudget?: number;
    log?: (level: 'warn' | 'error', message: string, err?: unknown) => void;
}

export function parseDisabled(raw: string): Set<string> {
    return new Set(
        String(raw ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    );
}

export function createFeatureSwitches(opts: FeatureSwitchOptions): FeatureSwitches {
    const budget = opts.errorBudget ?? 5;
    const log = opts.log ?? (() => {});
    let disabled = parseDisabled(opts.readDisabled());
    let safeMode = false;
    const errors = new Map<FeatureId, number>();
    const tripped = new Set<FeatureId>();

    const isEnabled = (id: FeatureId) => !tripped.has(id) && !(safeMode && !SAFE_MODE_FEATURES.has(id)) && !disabled.has(id);

    const reportError = (id: FeatureId, err: unknown) => {
        const n = (errors.get(id) ?? 0) + 1;
        errors.set(id, n);
        log('warn', `Feature "${id}" error ${n}/${budget}`, err);
        if (n >= budget && !tripped.has(id)) {
            tripped.add(id);
            log('error', `Feature "${id}" exceeded its error budget; off until Steam restarts.`);
        }
    };

    return {
        isEnabled,
        run(id, fn) {
            if (!isEnabled(id)) return undefined;
            try {
                return fn();
            } catch (err) {
                reportError(id, err);
                return undefined;
            }
        },
        reportError,
        setSafeMode(on) {
            safeMode = on;
        },
        reload() {
            disabled = parseDisabled(opts.readDisabled());
        },
        errorCount: () => [...errors.values()].reduce((a, b) => a + b, 0),
        diagnostics: () => ({
            safeMode,
            disabled: [...disabled],
            tripped: [...tripped],
            errors: Object.fromEntries(errors),
        }),
    };
}
