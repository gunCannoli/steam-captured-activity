import { createFeatureSwitches, type FeatureId, type FeatureSwitches, type FeatureSwitchOptions } from './features.ts';

/**
 * The plugin's one set of kill switches. Every module that writes into Steam asks
 * `isEnabled(id)` before it acts and calls `reportError(id, err)` from its fail-open
 * catch block. `initSafety` is called once by index.tsx; until then every feature
 * is enabled and errors are only counted.
 *
 * Every function here is O(1) (a few Set lookups): safe from a jsx handler or a
 * prototype hook (docs/plugins.md guardrail 2).
 *
 * Pure: no Steam, SDK or logger import (tests/safety.test.ts); the logger is injected.
 */

let switches: FeatureSwitches = createFeatureSwitches({ readDisabled: () => '' });

export function initSafety(opts: FeatureSwitchOptions & { safeMode: boolean }): void {
    switches = createFeatureSwitches(opts);
    switches.setSafeMode(opts.safeMode);
}

export function isEnabled(id: FeatureId): boolean {
    return switches.isEnabled(id);
}

export function reportError(id: FeatureId, err: unknown): void {
    switches.reportError(id, err);
}

/** Re-read the `disabledFeatures` setting. */
export function reloadSafety(): void {
    switches.reload();
}

export function errorCount(): number {
    return switches.errorCount();
}

/** For tests and the console: `PLUGIN_LIST[...].safetyDiagnostics()`. */
export function safetyDiagnostics(): ReturnType<FeatureSwitches['diagnostics']> {
    return switches.diagnostics();
}
