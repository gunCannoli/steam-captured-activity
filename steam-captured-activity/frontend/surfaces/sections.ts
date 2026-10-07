// Surface `sections`: Steam builds a shortcut's page from a three-item section list
// (`BIsModOrShortcut() && (s = ["nonsteam", "notes", "screenshots"])`), so the Activity section is never rendered
// for a non-Steam game, whatever its store holds. This puts `activity` back for a shortcut whose feed shows captures,
// so the plugin works without steam-cartridges (which restores the same section, and more, for every shortcut; the
// two patches chain, and adding a name twice to a Set is a no-op). Steam games keep Steam's own list.
import { logger } from "../logger";
import { isShortcutAppId } from "../kernel/appid";
import { appDetailsSections } from "../steam/stores";
import { safety } from "./context";

type GetSections = (overview: unknown, details: unknown) => Set<string>;
interface SectionsInstance {
    m_setSectionsMemo?: Set<string>;
    forceUpdate?: () => void;
}

let patched = false;
let wants: (appid: number) => boolean = () => false;

/**
 * Live instances of Steam's sections component, registered as they render, so a publish that finishes after the page
 * rendered can re-render it (the component observes Steam's stores, not ours). Dropped when re-rendering throws.
 */
const instances = new Set<SectionsInstance>();
/** Desktop and Big Picture each render one sections component per open page. */
const MAX_INSTANCES = 8;

function appidOf(overview: unknown): number | undefined {
    const appid = (overview as { appid?: unknown } | undefined)?.appid;
    return typeof appid === "number" && isShortcutAppId(appid) ? appid >>> 0 : undefined;
}

/** Install once. `hasCaptures` must be O(1): it is asked from inside Steam's render. */
export function installSectionsPatch(hasCaptures: (appid: number) => boolean): boolean {
    wants = hasCaptures;
    if (patched) return true;
    const component = appDetailsSections();
    const proto = component?.prototype as unknown as { GetSections: GetSections } | undefined;
    const base = proto?.GetSections;
    if (!proto || typeof base !== "function") {
        logger.warn("Steam's section registry was not found; shortcut pages keep Steam's own sections.");
        return false;
    }
    proto.GetSections = function (this: SectionsInstance, overview: unknown, details: unknown): Set<string> {
        // Steam returns its memo, sometimes a set from an earlier call: edit that object in place, or the change is
        // lost on a memo hit (steam-cartridges' surfaces/sections, verified live).
        const sections = base.call(this, overview, details);
        if (!safety.isEnabled("sections")) return sections;
        try {
            const appid = appidOf(overview);
            if (appid === undefined) return sections;
            if (!instances.has(this)) {
                instances.add(this);
                // An unmounted instance does not throw on forceUpdate: keep the newest few only.
                if (instances.size > MAX_INSTANCES) instances.delete(instances.values().next().value as SectionsInstance);
            }
            if (wants(appid) && !sections.has("activity")) {
                sections.add("activity");
                this.m_setSectionsMemo = sections;
            }
        } catch (err) {
            safety.reportError("sections", err);
        }
        return sections;
    };
    patched = true;
    logger.info("Activity section restored for shortcuts with captures.");
    return true;
}

let scheduled = false;

/** Re-render every live sections component, once per tick however many apps changed. Only our patched component. */
export function refreshSections(): void {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
        scheduled = false;
        for (const instance of [...instances]) {
            try {
                instance.m_setSectionsMemo = undefined;
                instance.forceUpdate?.();
            } catch {
                instances.delete(instance);
            }
        }
    }, 0);
}
