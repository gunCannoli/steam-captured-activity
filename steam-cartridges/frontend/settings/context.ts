// The only way settings panels reach the app (migration plan M8b, § 7.0 D3): `index.tsx` calls
// setPanelContext() at the top of init(); panels read it with usePanelContext(). Structural types only,
// never an import of app/, surfaces/ or features/. Backend calls go through ports/backend.ts.
import type { AutoRoutingProfile } from '../domain/routing/policy';
import type { SyncProgress } from './settings';

export interface PanelContext {
    routing: {
        listCollections(): { id: string; name: string; dynamic: boolean; shortcutCount: number }[];
        listShortcuts(): { appid: number; name: string }[];
        membersOf(id: string): ReadonlySet<number> | undefined;
        shortcutName(appid: number): string;
        getAutoRoutingProfile(appid: number): AutoRoutingProfile | undefined;
        /** Re-read the auto-routing profiles from the backend (the audit does this before each render). */
        reloadProfiles(): Promise<void>;
    };
    ingest: {
        progress(): SyncProgress;
        onProgress(fn: (p: SyncProgress) => void): () => void;
        trigger(delayMs?: number): void;
        start(opts?: { forceAll?: boolean; onlyAppids?: number[] }): Promise<void>;
    };
    records: {
        achievementsOf(appid: number): { nAchieved: number; nTotal: number } | undefined;
    };
    controller: { load(): Promise<void>; inferredFor(appid: number): boolean | undefined };
    steamStore: { setMapping(appid: number, steamAppid: number, name?: string): Promise<{ mapping?: unknown; error?: string }> };
    safety: {
        featureIds: readonly string[];
        diagnostics(): { safeMode: boolean; disabled: string[]; tripped: string[]; errors: Record<string, number> };
        surfaces(): { id: string; installed: boolean; disabled: boolean; errors: number; lastError?: string }[];
    };
}

const EMPTY_PROGRESS: SyncProgress = { isSyncing: false, total: 0, current: 0, currentGame: '', phase: 'idle' };

/** Inert until index.tsx wires the real one, so a panel opened early renders empty instead of throwing. */
const INERT: PanelContext = {
    routing: {
        listCollections: () => [],
        listShortcuts: () => [],
        membersOf: () => undefined,
        shortcutName: (appid) => String(appid),
        getAutoRoutingProfile: () => undefined,
        reloadProfiles: async () => {},
    },
    ingest: { progress: () => EMPTY_PROGRESS, onProgress: () => () => {}, trigger: () => {}, start: async () => {} },
    records: { achievementsOf: () => undefined },
    controller: { load: async () => {}, inferredFor: () => undefined },
    steamStore: { setMapping: async () => ({ error: 'not ready' }) },
    safety: { featureIds: [], diagnostics: () => ({ safeMode: false, disabled: [], tripped: [], errors: {} }), surfaces: () => [] },
};

let context: PanelContext = INERT;

export function setPanelContext(ctx: PanelContext): void {
    context = ctx;
}

export function usePanelContext(): PanelContext {
    return context;
}
