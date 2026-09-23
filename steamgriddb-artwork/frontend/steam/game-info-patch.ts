import { logger } from "../logger";

interface WebpackRequire {
    (id: string): any;
    m: Record<string, unknown>;
}

type ChunkGlobal = Array<
    [string[], Record<string, unknown>, ((r: WebpackRequire) => void)?]
>;

let cachedRequire: WebpackRequire | undefined;

function getSteamRequire(): WebpackRequire | undefined {
    if (cachedRequire) return cachedRequire;
    try {
        const chunks = (window as any).webpackChunksteamui as
            | ChunkGlobal
            | undefined;
        if (!Array.isArray(chunks)) return undefined;

        const key = `__nsga_meta_probe_${Date.now()}`;
        let captured: WebpackRequire | undefined;

        chunks.push([
            [key],
            {
                [key]: (_m: unknown, _e: unknown, r: WebpackRequire) => {
                    captured = r;
                },
            },
            (r: any) => {
                r((r.s = key));
            },
        ]);

        cachedRequire = captured;
    } catch (err) {
        logger.warn("Could not capture Steam module require:", err);
    }
    return cachedRequire;
}

const liveInstances = new Set<any>();

/**
 * Re-render all mounted Game Info container and overview components.
 * Called when metadata is loaded or updated asynchronously so Steam's UI
 * reflects newly injected descriptions and credits immediately.
 */
export function refreshGameInfoInstances(): void {
    for (const inst of [...liveInstances]) {
        try {
            inst.forceUpdate?.();
        } catch {
            liveInstances.delete(inst);
        }
    }
}

/**
 * Patch the inner GameInfo component (k) inside module 15448.
 *
 * Steam's native Game Info tab (Big Picture / GamepadUI) renders an inner component
 * that explicitly tests `overview.BIsModOrShortcut()`. If true, Steam drops the
 * descriptions (snippet and full description), developers, publishers, franchises,
 * and release date.
 *
 * When this shortcut has enriched metadata in appDetailsStore, we temporarily
 * shadow `BIsModOrShortcut = () => false` strictly during `k.prototype.render()`,
 * allowing Steam's native Description, Stats, and FeaturesList blocks to render.
 */
function patchKComponent(k: any): boolean {
    if (!k || typeof k !== "function" || !k.prototype) return false;
    if (k.__nsga_gameinfo_patched) return true;
    k.__nsga_gameinfo_patched = true;

    const origKRender = k.prototype.render;
    if (typeof origKRender !== "function") return false;

    k.prototype.render = function () {
        liveInstances.add(this);
        const overview = this.props?.overview;
        if (
            overview &&
            typeof overview.BIsModOrShortcut === "function" &&
            overview.BIsModOrShortcut()
        ) {
            const appData = (window as any).appDetailsStore?.GetAppData?.(
                overview.appid,
            );
            const hasMetadata = Boolean(
                appData?.descriptionsData?.strSnippet ||
                appData?.descriptionsData?.strFullDescription ||
                appData?.associationData?.rgDevelopers?.length,
            );

            if (hasMetadata) {
                const origBIsMod = overview.BIsModOrShortcut;
                try {
                    overview.BIsModOrShortcut = () => false;
                    return origKRender.apply(this, arguments);
                } finally {
                    overview.BIsModOrShortcut = origBIsMod;
                }
            }
        }

        return origKRender.apply(this, arguments);
    };

    logger.info(
        "Successfully patched Steam Game Info inner component (k.prototype.render).",
    );
    return true;
}

/**
 * Find Game Info container component G by stable prototype methods
 * (onCollapseStarted, onCollapseComplete, setBoxHeight) and patch its inner renderer.
 */
export function patchGameInfoComponent(): boolean {
    try {
        const req = getSteamRequire();
        if (!req?.m) {
            logger.warn(
                "Webpack require unavailable; Game Info patch deferred.",
            );
            return false;
        }

        let targetG: any = undefined;

        for (const id of Object.keys(req.m)) {
            let mod: any;
            try {
                mod = req(id);
            } catch {
                continue;
            }
            if (!mod || typeof mod !== "object") continue;

            for (const key of Object.keys(mod)) {
                const exp = mod[key];
                if (typeof exp === "function" && exp.prototype) {
                    const proto = exp.prototype;
                    if (
                        typeof proto.onCollapseStarted === "function" &&
                        typeof proto.onCollapseComplete === "function" &&
                        typeof proto.setBoxHeight === "function"
                    ) {
                        targetG = exp;
                        break;
                    }
                }
            }
            if (targetG) break;
        }

        if (!targetG) {
            logger.warn(
                "Could not locate Game Info container component by signature.",
            );
            return false;
        }

        // 1. Try extracting k upfront using a dummy props render
        try {
            const dummyProps = {
                overview: {
                    appid: 1,
                    BIsModOrShortcut: () => true,
                    GetCanonicalReleaseDate: () => 0,
                    display_name: "",
                },
                details: { unAppID: 1 },
                expand: true,
                collapsible: false,
            };
            const instG = new targetG(dummyProps);
            instG.props = dummyProps;
            const vdom = instG.render();
            const k = vdom?.props?.children?.[0]?.type;
            if (k) {
                patchKComponent(k);
            }
        } catch (err) {
            logger.info(
                "Upfront k extraction skipped; wrapping G.render hook.",
            );
        }

        // 2. Wrap G.prototype.render as an enduring safety guard
        if (!targetG.__nsga_g_patched) {
            targetG.__nsga_g_patched = true;
            const origGRender = targetG.prototype.render;
            targetG.prototype.render = function () {
                liveInstances.add(this);
                const vdom = origGRender.apply(this, arguments);
                const kChild = vdom?.props?.children?.[0]?.type;
                if (kChild) {
                    patchKComponent(kChild);
                }
                return vdom;
            };
        }

        logger.info(
            "Game Info native shortcut filter bypass hooked successfully.",
        );
        return true;
    } catch (err) {
        logger.warn("Failed to patch Game Info component:", err);
        return false;
    }
}
