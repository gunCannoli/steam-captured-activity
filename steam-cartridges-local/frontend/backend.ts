// The one door to this plugin's Lua backend. Every payload is shaped like steam-cartridges' AppContext (ADR-0063).

export interface AppContext {
    appid: number;
    gameid: string;
    isShortcut: boolean;
    displayName: string;
    exe?: string;
    launchOptions?: string;
    nativeAppid?: number;
    achievementIds?: string[];
}

export interface LocalUnlock {
    id: string;
    /** Unix seconds; 0 = unknown (steam-cartridges uses now). */
    unlockedAt: number;
}

export interface LocalFile {
    path: string;
    label: string;
    format: string;
}

/** Calls the backend of the -dev copy first, then the released one; null when neither answers. */
export async function callLocalBackend<R>(name: string, payload: object = {}): Promise<R | null> {
    const millennium = (window as any)["Millennium"];
    const callFn = millennium ? millennium["callServerMethod"] : undefined;
    if (typeof callFn !== "function") return null;
    for (const plugin of ["steam-cartridges-local-dev", "steam-cartridges-local"]) {
        try {
            const raw = await callFn.call(millennium, plugin, name, { payload: JSON.stringify(payload) });
            const res = typeof raw === "string" ? JSON.parse(raw) : raw;
            if (res && typeof res === "object") return res as R;
        } catch {
            // try the next name
        }
    }
    return null;
}

/** Lua returns an empty table as `{}`: never trust a list (guardrail 21). */
export function asList<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

export function unlocksOf(res: { unlocks?: unknown } | null): LocalUnlock[] {
    return asList<LocalUnlock>(res?.unlocks)
        .filter((u) => u && typeof u.id === "string" && u.id.length > 0)
        .map((u) => ({ id: u.id, unlockedAt: Number(u.unlockedAt) > 0 ? Number(u.unlockedAt) : 0 }));
}
