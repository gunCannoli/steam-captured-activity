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

let cachedDetailsStore: any = undefined;
let cachedAppStore: any = undefined;
let onTriggerAppView: ((appid: number) => void) | undefined;

export function setAppViewTrigger(fn: (appid: number) => void): void {
    onTriggerAppView = fn;
}

export function setCachedStores(detailsStore?: any, appStore?: any): void {
    if (detailsStore) cachedDetailsStore = detailsStore;
    if (appStore) cachedAppStore = appStore;
}

export function getAppDetailsStore(): any {
    if (cachedDetailsStore) return cachedDetailsStore;
    if (typeof (window as any).appDetailsStore !== "undefined") {
        cachedDetailsStore = (window as any).appDetailsStore;
        return cachedDetailsStore;
    }
    const req = getSteamRequire();
    if (req?.m) {
        for (const id of Object.keys(req.m)) {
            try {
                const exp = req(id);
                if (exp?.H?.GetDescriptions && exp?.H?.GetAssociations) {
                    cachedDetailsStore = exp.H;
                    return cachedDetailsStore;
                }
            } catch {}
        }
    }
    return undefined;
}

export function getAppStore(): any {
    if (cachedAppStore) return cachedAppStore;
    if (typeof (window as any).appStore !== "undefined") {
        cachedAppStore = (window as any).appStore;
        return cachedAppStore;
    }
    const req = getSteamRequire();
    if (req?.m) {
        for (const id of Object.keys(req.m)) {
            try {
                const exp = req(id);
                for (const k of Object.keys(exp || {})) {
                    if (exp[k]?.GetAppOverviewByAppID) {
                        cachedAppStore = exp[k];
                        return cachedAppStore;
                    }
                }
            } catch {}
        }
    }
    return undefined;
}

const liveInstances = new Set<any>();

/**
 * Re-render all mounted Game Info container and overview components across all windows.
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

    // Discover all active DOM documents (Desktop main window + Big Picture popup windows)
    const docs: Document[] = [];
    if (typeof document !== "undefined") docs.push(document);

    const req = getSteamRequire();
    if (req?.m) {
        for (const id of Object.keys(req.m)) {
            try {
                const mod = req(id);
                for (const k of Object.keys(mod || {})) {
                    if (mod[k]?.m_mapPopups) {
                        for (const popup of mod[k].m_mapPopups.values()) {
                            const doc = popup?.m_popup?.window?.document;
                            if (doc && !docs.includes(doc)) {
                                docs.push(doc);
                            }
                        }
                    }
                }
            } catch {}
        }
    }

    // In each document, locate mounted Game Info / Shortcut components and force update
    for (const doc of docs) {
        try {
            const el = doc.querySelector(
                '[class*="Shortcut"], [class*="GameInfoContainer"], [class*="InnerContainer"]',
            );
            if (!el) continue;
            const key = Object.keys(el).find(
                (k) =>
                    k.startsWith("__reactFiber$") ||
                    k.startsWith("__reactInternalInstance$"),
            );
            if (!key) continue;
            let fiber = (el as any)[key];
            while (fiber) {
                if (
                    fiber.type &&
                    (fiber.type.name === "k" ||
                        fiber.type.name === "G" ||
                        fiber.type.name === "ct")
                ) {
                    fiber.stateNode?.forceUpdate?.();
                }
                fiber = fiber.return;
            }
        } catch (err) {
            logger.warn("Error refreshing Game Info in document:", err);
        }
    }
}

function createPatchedOverview(overview: any): any {
    if (!overview) return overview;
    if (overview.__nsga_is_patched_proxy) return overview;
    return new Proxy(overview, {
        get(target, prop, receiver) {
            if (prop === "__nsga_is_patched_proxy") return true;
            if (prop === "BIsModOrShortcut") {
                return () => false;
            }
            const val = Reflect.get(target, prop, receiver);
            if (typeof val === "function") {
                return val.bind(target);
            }
            return val;
        },
    });
}

/**
 * Hook AppOverview.prototype.BIsModOrShortcut so that when the inner Game Info
 * component (k.render) checks if the app is a shortcut/mod, it returns false
 * if enriched metadata is present.
 *
 * This cleanly unblocks Steam's native GameDescription, Stats (developer/publisher),
 * and FeaturesList in Big Picture Mode without altering GetGameID() or affecting
 * other subsystems.
 */
function hookAppOverviewBIsModOrShortcut(): boolean {
    try {
        const appStore = getAppStore();
        const sample =
            appStore?.allApps?.[0] ||
            appStore?.GetAppOverviewByAppID?.(4263274102);

        let proto = sample ? Object.getPrototypeOf(sample) : undefined;
        while (
            proto &&
            !Object.prototype.hasOwnProperty.call(proto, "BIsModOrShortcut")
        ) {
            proto = Object.getPrototypeOf(proto);
        }

        if (!proto) {
            const req = getSteamRequire();
            if (req?.m) {
                for (const id of Object.keys(req.m)) {
                    try {
                        const exp = req(id);
                        for (const k of Object.keys(exp || {})) {
                            const candidate = exp[k];
                            if (
                                candidate?.prototype &&
                                typeof candidate.prototype.BIsModOrShortcut ===
                                    "function"
                            ) {
                                proto = candidate.prototype;
                                break;
                            }
                        }
                        if (proto) break;
                    } catch {}
                }
            }
        }

        if (!proto) {
            logger.warn("Could not find AppOverview prototype with BIsModOrShortcut.");
            return false;
        }

        if (proto.__nsga_bismod_hooked) return true;
        proto.__nsga_bismod_hooked = true;

        const origBIsMod = proto.BIsModOrShortcut;
        proto.BIsModOrShortcut = function () {
            const stack = new Error().stack || "";
            if (stack.includes("k.render") || stack.includes("GameInfo")) {
                const store = getAppDetailsStore();
                const appData = store?.GetAppData?.(this.appid);
                const hasMetadata = Boolean(
                    appData?.descriptionsData?.strSnippet ||
                        appData?.descriptionsData?.strFullDescription ||
                        appData?.associationData?.rgDevelopers?.length,
                );
                if (hasMetadata) {
                    return false;
                }
            }
            return origBIsMod.apply(this, arguments);
        };

        logger.info(
            "Successfully hooked AppOverview.prototype.BIsModOrShortcut for Game Info.",
        );
        return true;
    } catch (err) {
        logger.warn("Failed to hook AppOverview BIsModOrShortcut:", err);
        return false;
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
 * When this shortcut has enriched metadata in appDetailsStore, we proxy `overview`
 * with `BIsModOrShortcut = () => false` on props, allowing Steam's native Description,
 * Stats, and FeaturesList blocks to render without mutating the underlying AppOverview instance.
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
            const store = getAppDetailsStore();
            const appData = store?.GetAppData?.(overview.appid);
            const hasMetadata = Boolean(
                appData?.descriptionsData?.strSnippet ||
                    appData?.descriptionsData?.strFullDescription ||
                    appData?.associationData?.rgDevelopers?.length,
            );

            if (hasMetadata) {
                this.props = {
                    ...this.props,
                    overview: createPatchedOverview(overview),
                };
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
        hookAppOverviewBIsModOrShortcut();

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
                const overview = this.props?.overview;
                if (
                    overview &&
                    typeof overview.BIsModOrShortcut === "function" &&
                    overview.BIsModOrShortcut()
                ) {
                    onTriggerAppView?.(overview.appid);

                    const store = getAppDetailsStore();
                    const appData = store?.GetAppData?.(overview.appid);
                    const hasMetadata = Boolean(
                        appData?.descriptionsData?.strSnippet ||
                        appData?.descriptionsData?.strFullDescription ||
                        appData?.associationData?.rgDevelopers?.length,
                    );

                    if (hasMetadata) {
                        this.props = {
                            ...this.props,
                            overview: createPatchedOverview(overview),
                        };
                    }
                }

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
