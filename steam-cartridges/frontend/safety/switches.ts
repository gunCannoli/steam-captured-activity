// Safety: the plugin's one FeatureSwitches instance (migration plan M0b).
import { logger } from "../logger";
import { onSettingChange, setting } from "../settings/settings";
import { createFeatureSwitches } from "./features";

export const features = createFeatureSwitches({
    readDisabled: () => String(setting("disabledFeatures") ?? ""),
    log: (level, message, err) => {
        if (level === "error") logger.error(message, err ?? "");
        else logger.warn(message, err ?? "");
    },
});

onSettingChange((key) => {
    if (key === "disabledFeatures") features.reload();
});
