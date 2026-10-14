import { useEffect, useState } from 'react';
import { onSettingChange, setSetting, setting } from './current';
import type { ThirdPartySettings } from './defaults';

export { DEFAULTS, type ThirdPartySettings } from './defaults';

/** One setting in the panel, served from the shared in-memory copy (current.ts; Millennium#903 workaround there). */
export function useSetting<K extends keyof ThirdPartySettings>(
    key: K,
): [ThirdPartySettings[K], (val: ThirdPartySettings[K]) => void] {
    const [val, setVal] = useState<ThirdPartySettings[K]>(() => setting(key));

    useEffect(() => {
        setVal(setting(key));
        return onSettingChange((changed) => {
            if (changed === key) setVal(setting(key));
        });
    }, [key]);

    const update = (newVal: ThirdPartySettings[K]) => {
        void setSetting(key, newVal);
    };

    return [val, update];
}
