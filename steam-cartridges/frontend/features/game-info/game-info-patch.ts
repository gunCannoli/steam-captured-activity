import { logger } from "../../logger";
import { isNonSteamAppId } from "../../steam/route";

export const enrichedAppIds = new Set<number>();

export function isAppEnriched(appid: number): boolean {
    if (typeof appid !== "number") return false;
    return enrichedAppIds.has(appid) || enrichedAppIds.has(appid >>> 0) || enrichedAppIds.has(appid | 0);
}

export function markAppEnriched(appid: number): void {
    enrichedAppIds.add(appid);
    enrichedAppIds.add(appid >>> 0);
    enrichedAppIds.add(appid | 0);
}

export function unmarkAppEnriched(appid: number): void {
    enrichedAppIds.delete(appid);
    enrichedAppIds.delete(appid >>> 0);
    enrichedAppIds.delete(appid | 0);
}

interface WebpackRequire {
    (id: string): any;
    m: Record<string, unknown>;
}

type ChunkGlobal = Array<
    [string[], Record<string, unknown>, ((r: WebpackRequire) => void)?]
>;

let cachedRequire: WebpackRequire | undefined;

export function getSteamRequire(): WebpackRequire | undefined {
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
let onGetMetadata: ((appid: number) => any) | undefined;
let onEnrichGameDetails: ((appid: number, meta: any) => boolean) | undefined;

export function setAppViewTrigger(fn: (appid: number) => void): void {
    onTriggerAppView = fn;
}

export function setMetadataResolver(
    getMeta: (appid: number) => any,
    enrich: (appid: number, meta: any) => boolean,
): void {
    onGetMetadata = getMeta;
    onEnrichGameDetails = enrich;
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
    return undefined;
}

export function getAppStore(): any {
    if (cachedAppStore) return cachedAppStore;
    if (typeof (window as any).appStore !== "undefined") {
        cachedAppStore = (window as any).appStore;
        return cachedAppStore;
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

    // Discover active DOM documents (Desktop main window + Big Picture popup windows)
    const docs: Document[] = [];
    if (typeof document !== "undefined") docs.push(document);

    try {
        const popupMgr =
            (window as any).g_PopupManager ||
            (globalThis as any).g_PopupManager;
        const bpmPopup = popupMgr?.GetExistingPopup?.("SP BPM_uid0");
        const bpmDoc = bpmPopup?.window?.document;
        if (bpmDoc && !docs.includes(bpmDoc)) {
            docs.push(bpmDoc);
        }
        if (popupMgr?.m_mapPopups) {
            for (const popup of popupMgr.m_mapPopups.values()) {
                const doc =
                    popup?.m_popup?.window?.document || popup?.window?.document;
                if (doc && !docs.includes(doc)) {
                    docs.push(doc);
                }
            }
        }
    } catch {}

    // In each document, locate mounted Game Info / Shortcut components and force update
    for (const doc of docs) {
        try {
            const el = doc.querySelector(
                '[class*="Shortcut"], [class*="GameInfoContainer"], [class*="InnerContainer"], [class*="FeaturesList"]',
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
                        fiber.type.name === "ct" ||
                        typeof fiber.type === "function")
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
            if (prop === "GetGameID") {
                return () =>
                    target.m_gameid ||
                    (typeof target.GetGameID === "function"
                        ? target.GetGameID()
                        : target.appid?.toString());
            }
            if (prop === "gameid") {
                return target.m_gameid || target.gameid;
            }
            const val = Reflect.get(target, prop, receiver);
            if (typeof val === "function") {
                return val.bind(target);
            }
            return val;
        },
    });
}

const appCategoriesCache = new Map<number, Set<number>>();

export function setAppCategories(appid: number, categories: Set<number>): void {
    appCategoriesCache.set(appid, categories);
    appCategoriesCache.set(appid >>> 0, categories);
    appCategoriesCache.set(appid | 0, categories);
}

export function clearAppCategories(appid: number): void {
    appCategoriesCache.delete(appid);
    appCategoriesCache.delete(appid >>> 0);
    appCategoriesCache.delete(appid | 0);
}

export function getCachedCategoriesForApp(
    appid: number,
): Set<number> | undefined {
    return appCategoriesCache.get(appid) ||
        appCategoriesCache.get(appid >>> 0) ||
        appCategoriesCache.get(appid | 0);
}

/**
 * Hook AppOverview prototype chain:
 * BHasStoreCategory: Consults appCategoriesCache to dynamically return category flags
 * (Single-player, Multi-player, Co-op, Full Controller, Achievements, Remote Play Together).
 */
export function ensureAppOverviewHooked(overview: any): boolean {
    if (!overview) return false;
    let hookedAny = false;
    let curr: any = overview;
    while (curr && curr !== Object.prototype) {
        if (
            typeof curr.GetGameID === "function" &&
            !curr.__nsga_getgameid_hooked
        ) {
            curr.__nsga_getgameid_hooked = true;
            const origGetGameID = curr.GetGameID;
            curr.GetGameID = function () {
                if (this.m_gameid) {
                    return this.m_gameid;
                }
                return origGetGameID.apply(this, arguments);
            };
            hookedAny = true;
        }

        if (
            typeof curr.BHasStoreCategory === "function" &&
            !curr.__nsga_bhascat_hooked
        ) {
            curr.__nsga_bhascat_hooked = true;
            const origBHasStoreCategory = curr.BHasStoreCategory;
            curr.BHasStoreCategory = function (catId: number) {
                if (
                    this.m_setStoreCategories &&
                    this.m_setStoreCategories.has(catId)
                ) {
                    return true;
                }
                const cached = appCategoriesCache.get(this.appid) ||
                    appCategoriesCache.get(this.appid >>> 0) ||
                    appCategoriesCache.get(this.appid | 0);
                if (cached && cached.has(catId)) {
                    return true;
                }
                return origBHasStoreCategory
                    ? origBHasStoreCategory.call(this, catId)
                    : false;
            };
            hookedAny = true;
        }

        curr = Object.getPrototypeOf(curr);
    }
    return hookedAny;
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
        if (overview) {
            ensureAppOverviewHooked(overview);
        }
        if (
            overview &&
            (isNonSteamAppId(overview.appid) ||
                (typeof overview.BIsModOrShortcut === "function" &&
                    overview.BIsModOrShortcut()))
        ) {
            const rawAppid = overview.appid >>> 0;
            const store = getAppDetailsStore();
            let appData = store?.GetAppData?.(overview.appid) || store?.GetAppData?.(rawAppid);

            if (!appData?.descriptionsData?.strSnippet && onGetMetadata && onEnrichGameDetails) {
                const meta = onGetMetadata(rawAppid) || onGetMetadata(overview.appid);
                if (meta) {
                    onEnrichGameDetails(rawAppid, meta);
                    appData = store?.GetAppData?.(overview.appid) || store?.GetAppData?.(rawAppid);
                }
            }

            const hasMetadata =
                isAppEnriched(overview.appid) ||
                Boolean(
                    appData?.descriptionsData?.strSnippet ||
                    appData?.descriptionsData?.strFullDescription ||
                    appData?.associationData?.rgDevelopers?.length ||
                    appData?.associationData?.rgPublishers?.length ||
                    appData?.associationData?.rgFranchises?.length,
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

let hasPatchedGameInfo = false;

/**
 * Find Game Info container component G by stable prototype methods
 * (onCollapseStarted, onCollapseComplete, setBoxHeight) and patch its inner renderer.
 */
export function patchGameInfoComponent(): boolean {
    if (hasPatchedGameInfo) return true;

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
                const overview = this.props?.overview;
                if (overview) {
                    ensureAppOverviewHooked(overview);
                }
                if (
                    overview &&
                    (isNonSteamAppId(overview.appid) ||
                        (typeof overview.BIsModOrShortcut === "function" &&
                            overview.BIsModOrShortcut()))
                ) {
                    const rawAppid = overview.appid >>> 0;
                    onTriggerAppView?.(rawAppid);

                    const store = getAppDetailsStore();
                    let appData = store?.GetAppData?.(overview.appid) || store?.GetAppData?.(rawAppid);

                    if (!appData?.descriptionsData?.strSnippet && onGetMetadata && onEnrichGameDetails) {
                        const meta = onGetMetadata(rawAppid) || onGetMetadata(overview.appid);
                        if (meta) {
                            onEnrichGameDetails(rawAppid, meta);
                            appData = store?.GetAppData?.(overview.appid) || store?.GetAppData?.(rawAppid);
                        }
                    }

                    const hasMetadata =
                        isAppEnriched(overview.appid) ||
                        Boolean(
                            appData?.descriptionsData?.strSnippet ||
                            appData?.descriptionsData?.strFullDescription ||
                            appData?.associationData?.rgDevelopers?.length ||
                            appData?.associationData?.rgPublishers?.length ||
                            appData?.associationData?.rgFranchises?.length,
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

        hasPatchedGameInfo = true;
        logger.info(
            "Game Info native shortcut filter bypass hooked successfully.",
        );
        return true;
    } catch (err) {
        logger.warn("Failed to patch Game Info component:", err);
        return false;
    }
}
