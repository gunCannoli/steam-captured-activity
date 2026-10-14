// The plugin's settings: one in-memory copy, read from Millennium's plugin config at start-up, used by the push,
// auto-add, Epic launch hold, Xbox mute and the settings panel (`useSetting`, settings.ts).
//
// Millennium#903 workaround (docs/knowledgebase.md, same as steam-cartridges' settings.ts): every `pluginConfig` call
// rejects with "type must be string, but is number" although the operation ran. So `get`/`getAll` never return a value
// (read through Millennium's own `PluginConfig_GetAll` FFI instead), `set` persists but rejects (tolerated, then read
// back), and frontend-origin writes raise no change event (listeners are notified here). Before this, every read
// failed into the defaults, so auto-add was off after each Steam start whatever the toggle said.
import { pluginConfig, subscribePluginConfig } from "@steambrew/client";
import { logger } from "../logger";
import { DEFAULTS, type ThirdPartySettings } from "./defaults";

type Key = keyof ThirdPartySettings;
type ConfigApi = {
    getAll(plugin: string): Promise<Record<string, unknown>>;
    set(plugin: string, key: string, value: unknown): Promise<void>;
};
type Ffi = (plugin: string, method: string) => (...args: unknown[]) => Promise<unknown>;

const values: Partial<ThirdPartySettings> = {};
const listeners: ((key: Key) => void)[] = [];
let started: Promise<void> | undefined;
const config = pluginConfig as unknown as ConfigApi;

/** Our plugin name as Millennium loaded it (`-dev` copy or released). */
function pluginName(): string {
    const loaded = (globalThis as any).PLUGIN_LIST as Record<string, unknown> | undefined;
    return ["steam-cartridges-third-party-dev", "steam-cartridges-third-party"].find((n) => loaded && n in loaded) ?? "steam-cartridges-third-party";
}

async function readStored(): Promise<Record<string, unknown>> {
    const name = pluginName();
    try {
        return (await config.getAll(name)) ?? {};
    } catch {
        const ffi = ((globalThis as any).MILLENNIUM_API as { ffi?: Ffi } | undefined)?.ffi;
        if (!ffi) throw new Error("No way to read plugin config on this Millennium build.");
        return ((await ffi("core", "PluginConfig_GetAll")(name)) as Record<string, unknown>) ?? {};
    }
}

function merge<K extends Key>(key: K, raw: unknown): ThirdPartySettings[K] {
    if (raw === undefined || raw === null) return DEFAULTS[key];
    if (typeof DEFAULTS[key] === "object" && typeof raw === "object") return { ...(DEFAULTS[key] as object), ...(raw as object) } as ThirdPartySettings[K];
    return raw as ThirdPartySettings[K];
}

function apply(key: string, raw: unknown): void {
    if (!(key in DEFAULTS)) return;
    const k = key as Key;
    const before = JSON.stringify(setting(k));
    (values as Record<string, unknown>)[k] = merge(k, raw);
    if (JSON.stringify(values[k]) === before) return;
    for (const fn of listeners) {
        try {
            fn(k);
        } catch {
            // a listener's failure never stops the others
        }
    }
}

async function sync(): Promise<void> {
    const stored = await readStored();
    for (const key of Object.keys(DEFAULTS)) apply(key, stored[key]);
}

/** Reads every setting once and follows changes. Resolves when the first read is done (or failed: defaults then). */
export function startSettings(): Promise<void> {
    if (started) return started;
    try {
        subscribePluginConfig((key: string, val: unknown) => apply(key, val));
    } catch {
        // our own writes go through setSetting, which notifies
    }
    started = sync().catch((err) => logger.warn("Could not read plugin config; using defaults.", err));
    return started;
}

export function setting<K extends Key>(key: K): ThirdPartySettings[K] {
    return (key in values ? values[key] : DEFAULTS[key]) as ThirdPartySettings[K];
}

/** Stores a value: the in-memory copy and its listeners at once, then Millennium's config (read back after). */
export async function setSetting<K extends Key>(key: K, value: ThirdPartySettings[K]): Promise<void> {
    apply(key, value);
    try {
        await config.set(pluginName(), key, value);
    } catch (err) {
        if (!String(err).includes("type must be string")) {
            logger.warn(`Could not save setting ${key}:`, err);
            return;
        }
    }
    await sync().catch(() => undefined);
}

/** Follows changes; returns the unsubscribe. */
export function onSettingChange(fn: (key: Key) => void): () => void {
    listeners.push(fn);
    return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
    };
}

/** Which stores the user has switched on (settings services). */
export function storesOn(): { epic: boolean; xbox: boolean } {
    const s = setting("services");
    return { epic: s?.epicEnabled !== false, xbox: s?.xboxEnabled !== false };
}
