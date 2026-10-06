import { useEffect, useState } from 'react';
import { pluginConfig, subscribePluginConfig } from '@steambrew/client';

export interface ThirdPartySettings {
    services: { epicEnabled: boolean; xboxEnabled: boolean };
    autoAddEpicGames: boolean;
    autoAddXboxGames: boolean;
    epicOverlayWorkaround: boolean;
}

const DEFAULTS: ThirdPartySettings = {
    services: { epicEnabled: true, xboxEnabled: true },
    autoAddEpicGames: false,
    autoAddXboxGames: false,
    epicOverlayWorkaround: false,
};

export function useSetting<K extends keyof ThirdPartySettings>(
    key: K,
): [ThirdPartySettings[K], (val: ThirdPartySettings[K]) => void] {
    const [val, setVal] = useState<ThirdPartySettings[K]>(DEFAULTS[key]);

    useEffect(() => {
        let mounted = true;
        pluginConfig.get<ThirdPartySettings[K]>(key as string).then((stored) => {
            if (mounted && stored !== undefined) setVal(stored);
        }).catch(() => {});

        const unsub = subscribePluginConfig((changedKey: string, newVal: any) => {
            if (changedKey === key && mounted && newVal !== undefined) {
                setVal(newVal);
            }
        });
        return () => {
            mounted = false;
            unsub?.();
        };
    }, [key]);

    const update = (newVal: ThirdPartySettings[K]) => {
        setVal(newVal);
        pluginConfig.set(key as string, newVal).catch(() => {});
    };

    return [val, update];
}
