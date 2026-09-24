import { useEffect, useState } from 'react';
import { pluginConfig, subscribePluginConfig } from '@steambrew/client';
import defaults from '../../settings.json';
import { logger } from '../logger';

/**
 * Plugin settings, backed by Millennium's Configuration API.
 *
 * Defaults ship in settings.json (bundled here at build time). Millennium has
 * no way to declare defaults, so an unset key reads `undefined` and every value
 * is `stored ?? default`. Nothing is written until the user changes a setting,
 * so updated defaults still reach everyone who never touched that setting.
 *
 * Reads are served from an in-memory copy: hooks run per toast and must never
 * do an IPC round trip (docs/enhanced-achievements-plan.md, guardrail 5).
 *
 * Millennium bug workaround (verified live on loader 2026-08-18, lib 1.1.2;
 * docs/knowledgebase.md § Plugin settings): the SDK's `pluginConfig` sends its
 * operation as a number and the backend rejects it while building the reply.
 * So `set`/`delete` DO persist but reject with "type must be string, but is
 * number", `get`/`getAll` always fail, and no change events are delivered.
 * This module therefore reads through Millennium's own `PluginConfig_GetAll`
 * FFI when `getAll` fails, confirms writes by reading back, and notifies its
 * own listeners. `usePluginConfig` is not used for the same reason.
 */

export interface Settings {
    theme: string;
    'banner.enabled': boolean;
    'sound.enabled': boolean;
    'screenshot.enabled': boolean;
    'screenshot.delay_ms': number;
    'recording.enabled': boolean;
    'recording.duration_s': number;
    'recording.delay_ms': number;
    'recording.add_timeline_marker': boolean;
}

export type SettingKey = keyof Settings;

/** settings.json flattened into config keys. */
export const DEFAULTS: Settings = {
    theme: defaults.theme,
    'banner.enabled': defaults.banner.enabled,
    'sound.enabled': defaults.sound.enabled,
    'screenshot.enabled': defaults.screenshot.enabled,
    'screenshot.delay_ms': defaults.screenshot.delay_ms,
    'recording.enabled': defaults.recording.enabled,
    'recording.duration_s': defaults.recording.duration_s,
    'recording.delay_ms': defaults.recording.delay_ms,
    'recording.add_timeline_marker': defaults.recording.add_timeline_marker,
};

/** Numeric ranges; also used by the settings panel's sliders. */
export const RANGES: Partial<Record<SettingKey, { min: number; max: number; step: number }>> = {
    'screenshot.delay_ms': { min: 0, max: 5000, step: 100 },
    'recording.duration_s': { min: 5, max: 60, step: 5 },
    'recording.delay_ms': { min: 0, max: 5000, step: 100 },
};

/** A stored value of the wrong type or out of range is ignored, never thrown. */
function validate<K extends SettingKey>(key: K, value: unknown): Settings[K] | undefined {
    const fallback = DEFAULTS[key];
    if (typeof value !== typeof fallback) return undefined;
    if (typeof value === 'number') {
        const range = RANGES[key];
        if (!Number.isFinite(value) || (range && (value < range.min || value > range.max))) return undefined;
    }
    if (typeof value === 'string' && value.length === 0) return undefined;
    return value as Settings[K];
}

const current: Settings = { ...DEFAULTS };
const listeners = new Set<(key: SettingKey) => void>();

function apply(key: string, value: unknown): void {
    if (!(key in DEFAULTS)) return;
    const k = key as SettingKey;
    const unset = value === undefined || value === null;
    const valid = unset ? undefined : validate(k, value);
    if (!unset && valid === undefined) logger.warn(`Ignoring invalid stored value for ${k}:`, value);
    const next = valid ?? DEFAULTS[k];
    if (current[k] === next) return;
    (current as unknown as Record<string, unknown>)[k] = next;
    for (const listener of listeners) {
        try {
            listener(k);
        } catch (error) {
            logger.warn('Settings listener threw:', error);
        }
    }
}

// --- Millennium config access -------------------------------------------------

type ConfigApi = {
    getAll(plugin: string): Promise<Record<string, unknown>>;
    set(plugin: string, key: string, value: unknown): Promise<void>;
    delete(plugin: string, key: string): Promise<void>;
};
type Ffi = (plugin: string, method: string) => (...args: unknown[]) => Promise<unknown>;

/** Our own plugin name as Millennium loaded it (`-dev` copy or released). */
function pluginName(): string {
    const loaded = Reflect.get(globalThis, 'PLUGIN_LIST') as Record<string, unknown> | undefined;
    return ['enhanced-achievements-dev', 'enhanced-achievements'].find((n) => loaded && n in loaded) ?? 'enhanced-achievements';
}

/** The SDK's types only expose the implicit-plugin overloads; the runtime also takes the name. */
const config = pluginConfig as unknown as ConfigApi;

async function readStored(): Promise<Record<string, unknown>> {
    const name = pluginName();
    try {
        return (await config.getAll(name)) ?? {};
    } catch {
        // Millennium bug (see header): fall back to the FFI its own settings UI uses.
        const ffi = (Reflect.get(globalThis, 'MILLENNIUM_API') as { ffi?: Ffi } | undefined)?.ffi;
        if (!ffi) throw new Error('No way to read plugin config on this Millennium build.');
        return ((await ffi('core', 'PluginConfig_GetAll')(name)) as Record<string, unknown>) ?? {};
    }
}

/** Re-read everything from Millennium and apply it (also resets keys that were deleted). */
async function sync(): Promise<void> {
    const stored = await readStored();
    for (const key of Object.keys(DEFAULTS)) apply(key, stored[key]);
}

/** Run a config write, tolerating Millennium's bogus reply error, then confirm by reading back. */
async function write(op: (name: string) => Promise<void>): Promise<void> {
    try {
        await op(pluginName());
    } catch (error) {
        if (!String(error).includes('type must be string')) throw error;
    }
    await sync();
}

// --- public API ---------------------------------------------------------------

/** Load stored values once and keep them current. Call once at startup. */
export async function initSettings(): Promise<void> {
    try {
        await sync();
    } catch (error) {
        logger.warn('Could not read plugin config; using defaults.', error);
    }
    // For Millennium builds where change events work (not the one verified above).
    try {
        subscribePluginConfig((key, value) => apply(key, value));
    } catch {
        /* no events on this build; writes go through write() which syncs */
    }
}

/** O(1) read from the in-memory copy. */
export function setting<K extends SettingKey>(key: K): Settings[K] {
    return current[key];
}

export function onSettingChange(listener: (key: SettingKey) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function setSetting<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
    // Storing the default is the same as not storing anything: delete instead,
    // so future default changes still reach this user.
    return value === DEFAULTS[key] ? write((n) => config.delete(n, key)) : write((n) => config.set(n, key, value));
}

/** Forget every stored value, so all settings return to the shipped defaults. */
export async function resetSettings(): Promise<void> {
    for (const key of Object.keys(DEFAULTS)) {
        await write((n) => config.delete(n, key));
    }
}

/** React hook over the in-memory copy, for the settings panel. */
export function useSetting<K extends SettingKey>(key: K): [Settings[K], (value: Settings[K]) => void] {
    const [value, setValue] = useState(() => setting(key));
    useEffect(() => onSettingChange((k) => k === key && setValue(setting(key))), [key]);
    return [
        value,
        (next) => {
            setValue(next); // optimistic; sync() corrects it if the write did not land
            setSetting(key, next).catch((error) => {
                logger.error(`Could not save ${key}:`, error);
                setValue(setting(key));
            });
        },
    ];
}
