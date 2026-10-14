import { useEffect, useState } from 'react';
import { pluginConfig, subscribePluginConfig } from '@steambrew/client';

export interface ThirdPartySettings {
    services: { epicEnabled: boolean; xboxEnabled: boolean };
    autoAddEpicGames: boolean;
    autoAddXboxGames: boolean;
    epicOverlayWorkaround: boolean;
    muteXboxNotifications: boolean;
}

export const DEFAULTS: ThirdPartySettings = {
    services: { epicEnabled: true, xboxEnabled: true },
    autoAddEpicGames: false,
    autoAddXboxGames: false,
    epicOverlayWorkaround: false,
    muteXboxNotifications: false,
};

export function useSetting<K extends keyof ThirdPartySettings>(
    key: K,
): [ThirdPartySettings[K], (val: ThirdPartySettings[K]) => void] {
    const [val, setVal] = useState<ThirdPartySettings[K]>(DEFAULTS[key]);

    useEffect(() => {
        let mounted = true;
        pluginConfig.get<ThirdPartySettings[K]>(key as string).then((stored) => {
            if (mounted && stored !== undefined && stored !== null) {
                if (typeof DEFAULTS[key] === 'object' && typeof stored === 'object') {
                    setVal({ ...DEFAULTS[key], ...stored });
                } else {
                    setVal(stored);
                }
            }
        }).catch(() => {});

        const unsub = subscribePluginConfig((changedKey: string, newVal: any) => {
            if (changedKey === key && mounted && newVal !== undefined && newVal !== null) {
                if (typeof DEFAULTS[key] === 'object' && typeof newVal === 'object') {
                    setVal({ ...DEFAULTS[key], ...newVal });
                } else {
                    setVal(newVal);
                }
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
