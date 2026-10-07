// Settings: Millennium's per-plugin config, kept in memory (O(1) reads). The same workaround as steam-cartridges'
// settings/settings.ts for Millennium#903 (knowledgebase.md § Configuration API): read with getAll, falling back to
// Millennium's own FFI; write with set/delete, tolerating that bug's error and confirming by reading back; notify
// listeners ourselves (frontend writes raise no change event).
import { useEffect, useState } from "react";
import { pluginConfig, subscribePluginConfig } from "@steambrew/client";
import { logger } from "../logger";

export interface Settings {
    /** Captures in the Activity feed of Steam games. */
    steamGames: boolean;
    /** Captures in the Activity feed of non-Steam shortcuts. */
    nonSteamGames: boolean;
}
export type SettingKey = keyof Settings;

export const DEFAULTS: Settings = { steamGames: true, nonSteamGames: true };

const current: Settings = { ...DEFAULTS };
const listeners = new Set<(key: SettingKey) => void>();

function apply(key: string, value: unknown): void {
    if (!(key in DEFAULTS)) return;
    const k = key as SettingKey;
    let raw = value;
    if (typeof raw === "string") {
        try {
            raw = JSON.parse(raw); // some Millennium builds hand JSON values back as strings
        } catch {
            /* keep the string */
        }
    }
    const next = raw === undefined || raw === null ? DEFAULTS[k] : raw !== false;
    if (current[k] === next) return;
    current[k] = next;
    for (const listener of listeners) {
        try {
            listener(k);
        } catch (error) {
            logger.warn("Settings listener threw:", error);
        }
    }
}

type ConfigApi = {
    getAll(plugin: string): Promise<Record<string, unknown>>;
    set(plugin: string, key: string, value: unknown): Promise<void>;
    delete(plugin: string, key: string): Promise<void>;
};
type Ffi = (plugin: string, method: string) => (...args: unknown[]) => Promise<unknown>;

/** Our plugin name as Millennium loaded it (`-dev` copy or released). */
export function pluginName(): string {
    const loaded = Reflect.get(globalThis, "PLUGIN_LIST") as Record<string, unknown> | undefined;
    return ["steam-captured-activity-dev", "steam-captured-activity"].find((n) => loaded && n in loaded) ?? "steam-captured-activity";
}

const config = pluginConfig as unknown as ConfigApi;

async function readStored(): Promise<Record<string, unknown>> {
    const name = pluginName();
    try {
        return (await config.getAll(name)) ?? {};
    } catch {
        const ffi = (Reflect.get(globalThis, "MILLENNIUM_API") as { ffi?: Ffi } | undefined)?.ffi;
        if (!ffi) throw new Error("No way to read plugin config on this Millennium build.");
        return ((await ffi("core", "PluginConfig_GetAll")(name)) as Record<string, unknown>) ?? {};
    }
}

async function sync(): Promise<void> {
    const stored = await readStored();
    for (const key of Object.keys(DEFAULTS)) apply(key, stored[key]);
}

async function write(op: (name: string) => Promise<void>): Promise<void> {
    try {
        await op(pluginName());
    } catch (error) {
        if (!String(error).includes("type must be string")) throw error;
    }
    await sync();
}

/** Load stored values once and keep them current. Call once at start-up. */
export async function initSettings(): Promise<void> {
    try {
        await sync();
    } catch (error) {
        logger.warn("Could not read plugin config; using defaults.", error);
    }
    try {
        subscribePluginConfig((key, value) => apply(key, value));
    } catch {
        /* our own writes go through write(), which syncs */
    }
}

export function setting<K extends SettingKey>(key: K): Settings[K] {
    return current[key];
}

export function onSettingChange(listener: (key: SettingKey) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Persists a value. Storing the default deletes the key. */
export function setSetting<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
    const valid = value !== false;
    return valid === DEFAULTS[key] ? write((n) => config.delete(n, key)) : write((n) => config.set(n, key, valid));
}

/** Forget every stored value. */
export async function resetSettings(): Promise<void> {
    for (const key of Object.keys(DEFAULTS)) await write((n) => config.delete(n, key));
}

/** React hook over the in-memory copy, for the settings panel. */
export function useSetting<K extends SettingKey>(key: K): [Settings[K], (value: Settings[K]) => void] {
    const [value, setValue] = useState(() => setting(key));
    useEffect(() => onSettingChange((k) => k === key && setValue(setting(key))), [key]);
    return [
        value,
        (next) => {
            setValue(next);
            setSetting(key, next).catch((error) => {
                logger.error(`Could not save ${key}:`, error);
                setValue(setting(key));
            });
        },
    ];
}
