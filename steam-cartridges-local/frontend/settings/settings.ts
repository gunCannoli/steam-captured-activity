import { useEffect, useState } from "react";
import { pluginConfig, subscribePluginConfig } from "@steambrew/client";

export interface LocalSettings {
    /** Watch the game's achievement files while it runs, and report unlocks as they happen (ADR-0063). */
    watchWhilePlaying: boolean;
}

export const DEFAULTS: LocalSettings = {
    watchWhilePlaying: true,
};

/** A setting outside React, with its default when unset or unreadable (guardrail 22.4). */
export async function getSetting<K extends keyof LocalSettings>(key: K): Promise<LocalSettings[K]> {
    try {
        const stored = await pluginConfig.get<LocalSettings[K]>(key as string);
        return stored === undefined || stored === null ? DEFAULTS[key] : stored;
    } catch {
        return DEFAULTS[key];
    }
}

export function useSetting<K extends keyof LocalSettings>(key: K): [LocalSettings[K], (val: LocalSettings[K]) => void] {
    const [val, setVal] = useState<LocalSettings[K]>(DEFAULTS[key]);
    useEffect(() => {
        let mounted = true;
        void getSetting(key).then((v) => {
            if (mounted) setVal(v);
        });
        const unsub = subscribePluginConfig((changedKey: string, newVal: any) => {
            if (changedKey === key && mounted && newVal !== undefined && newVal !== null) setVal(newVal);
        });
        return () => {
            mounted = false;
            unsub?.();
        };
    }, [key]);
    const update = (newVal: LocalSettings[K]) => {
        setVal(newVal);
        pluginConfig.set(key as string, newVal).catch(() => {});
    };
    return [val, update];
}
