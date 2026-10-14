// The plugin's settings outside React (the push, auto-add, Epic launch hold, Xbox mute): the last value read from
// Millennium's plugin config, kept current by its change events. The settings panel uses `useSetting` (settings.ts).
import { pluginConfig, subscribePluginConfig } from "@steambrew/client";
import { DEFAULTS, type ThirdPartySettings } from "./settings";

type Key = keyof ThirdPartySettings;

const values: Partial<ThirdPartySettings> = {};
const listeners: ((key: Key) => void)[] = [];
let started: Promise<void> | undefined;

function merge<K extends Key>(key: K, raw: unknown): ThirdPartySettings[K] {
    if (raw === undefined || raw === null) return DEFAULTS[key];
    if (typeof DEFAULTS[key] === "object" && typeof raw === "object") return { ...(DEFAULTS[key] as object), ...(raw as object) } as ThirdPartySettings[K];
    return raw as ThirdPartySettings[K];
}

/** Reads every setting once and follows changes. Resolves when the first read is done (or failed: defaults then). */
export function startSettings(): Promise<void> {
    if (started) return started;
    subscribePluginConfig((key: string, val: unknown) => {
        if (!(key in DEFAULTS)) return;
        (values as Record<string, unknown>)[key] = merge(key as Key, val);
        for (const fn of listeners) {
            try {
                fn(key as Key);
            } catch {
                // a listener's failure never stops the others
            }
        }
    });
    started = Promise.all(
        (Object.keys(DEFAULTS) as Key[]).map((key) =>
            pluginConfig.get(key as string).then((v: unknown) => {
                (values as Record<string, unknown>)[key] = merge(key, v);
            }).catch(() => undefined),
        ),
    ).then(() => undefined);
    return started;
}

export function setting<K extends Key>(key: K): ThirdPartySettings[K] {
    return (key in values ? values[key] : DEFAULTS[key]) as ThirdPartySettings[K];
}

export function onSettingChange(fn: (key: Key) => void): void {
    listeners.push(fn);
}

/** Which stores the user has switched on (settings services). */
export function storesOn(): { epic: boolean; xbox: boolean } {
    const s = setting("services");
    return { epic: s?.epicEnabled !== false, xbox: s?.xboxEnabled !== false };
}
