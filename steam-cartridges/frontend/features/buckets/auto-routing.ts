import { logger } from "../../logger";
import { rpc, type AutoRoutingProfile } from "../../rpc";

const profiles = new Map<number, AutoRoutingProfile>();

export async function loadAutoRoutingProfiles(): Promise<void> {
    try {
        const res = await rpc.getAutoRoutingProfiles();
        profiles.clear();
        for (const [key, value] of Object.entries(res?.profiles ?? {})) {
            const appid = Number(key);
            if (Number.isFinite(appid) && value) profiles.set(appid, value);
        }
        logger.info(`Auto routing profiles loaded for ${profiles.size} shortcut(s).`);
    } catch (err) {
        logger.warn("Could not load auto routing profiles.", err);
    }
}

export function getAutoRoutingProfile(appid: number): AutoRoutingProfile | undefined {
    return (
        profiles.get(appid) ??
        profiles.get(appid >>> 0) ??
        profiles.get(appid | 0)
    );
}

export function getAllAutoRoutingProfiles(): Map<number, AutoRoutingProfile> {
    return profiles;
}
