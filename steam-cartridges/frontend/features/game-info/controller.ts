import { logger } from "../../logger";
import { rpc } from "../../rpc";
import { setting } from "../../settings/settings";
import type { ControllerContext } from "./category-policy";

/**
 * Controller support inferred from each shortcut's emulator (backend
 * emulator_controllers.lua), loaded once at startup (ADR-0038 addendum).
 */
const inferred = new Map<number, boolean>();

export async function loadControllerInference(): Promise<void> {
    try {
        const res = await rpc.getControllerInference();
        inferred.clear();
        for (const [key, value] of Object.entries(res?.games ?? {})) {
            const appid = Number(key);
            if (Number.isFinite(appid) && typeof value === "boolean") inferred.set(appid, value);
        }
        logger.info(`Controller support inferred for ${inferred.size} shortcut(s) from their emulator.`);
    } catch (err) {
        logger.warn("Could not load controller inference; only the default setting applies.", err);
    }
}

/** O(1): what decides the controller badge of a shortcut without Steam Store data. */
export function controllerContext(appid: number): ControllerContext {
    return { inferred: inferred.get(appid), defaultFull: setting("defaultFullController") };
}
