// Surface `game-info` (migration plan M3.3, ADR-0039): Steam's Game Info components and the
// AppOverview hooks that let a shortcut show them. Moved from features/game-info/game-info-patch.ts.
import { logger } from "../../logger";
import { steamRequire } from "../../steam/modules";
import { createPatchedOverview } from "../../steam/overview-proxy";
import { isShortcutAppId } from "../../kernel/appid";
import { deps } from "./deps";

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

let cachedDetailsStore: any = undefined;
let cachedAppStore: any = undefined;
const onGetMetadata = (appid: number): any => deps.metadataOf(appid);
let onEnrichGameDetails: ((appid: number, meta: any) => boolean) | undefined;

/** metadata.ts registers its enrichGameDetails here (patch.ts must not import it: a cycle). */
export function setEnricher(enrich: (appid: number, meta: any) => boolean): void {
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

/** Mounted components, held weakly (K3): an unmounted instance is collected instead of kept alive, and
 *  `forceUpdate` on one is a no-op anyway. `tracked` dedupes the per-render add. */
const liveInstances = new Set<WeakRef<any>>();
const tracked = new WeakSet<object>();

function remember(inst: any): void {
    if (!inst || typeof inst !== "object" || tracked.has(inst)) return;
    tracked.add(inst);
    liveInstances.add(new WeakRef(inst));
}

/** Remember a mounted component so refreshGameInfoInstances re-renders it (the playbar surface uses this). */
export function trackInstance(inst: any): void {
    remember(inst);
}

/**
 * Re-render all mounted Game Info container and overview components across all windows.
 * Called when metadata is loaded or updated asynchronously so Steam's UI
 * reflects newly injected descriptions and credits immediately.
 */
export function refreshGameInfoInstances(): void {
    for (const ref of [...liveInstances]) {
        const inst = ref.deref();
        if (!inst) {
            liveInstances.delete(ref); // collected: it was unmounted
            continue;
        }
        try {
            inst.forceUpdate?.();
        } catch {
            liveInstances.delete(ref);
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
        // Only the main window and Big Picture host Game Info. Never walk other popups
        // (Properties, dialogs): force-updating their trees hung SharedJSContext (M0a).
    } catch {}

    // In each document, locate mounted Game Info / Shortcut components and force update
    for (const doc of docs) {
        try {
            const el = doc.querySelector(
                '[class*="Shortcut"], [class*="GameInfoContainer"], [class*="InnerContainer"], [class*="FeaturesList"], [class*="PlayBar"], [class*="AppButtonsContainer"], [class*="AppGameInfoContainer"]',
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
                    (fiber.type.__nsga_props_hooked === true ||
                        fiber.type.__nsga_gameinfo_patched === true)
                ) {
                    const inst = fiber.stateNode;
                    if (inst) {
                        if (
                            Object.prototype.hasOwnProperty.call(inst, "props")
                        ) {
                            const cur = inst.props;
                            delete inst.props;
                            inst.props = cur;
                        }
                        inst.forceUpdate?.();
                    }
                }
                fiber = fiber.return;
            }
        } catch (err) {
            logger.warn("Error refreshing Game Info in document:", err);
        }
    }
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
                if (!deps.isEnabled("game-info")) return origGetGameID.apply(this, arguments);
                try {
                    if (this.m_gameid) {
                        return this.m_gameid;
                    }
                } catch (err) {
                    deps.reportError("game-info", err); // fail-open (plan § 7.0 D6)
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
                if (!deps.isEnabled("game-info")) {
                    return origBHasStoreCategory ? origBHasStoreCategory.call(this, catId) : false;
                }
                try {
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
                } catch (err) {
                    deps.reportError("game-info", err); // fail-open (plan § 7.0 D6)
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
/**
 * Hooks a React class component's prototype `props` descriptor.
 *
 * In Steam's CEF environment, components wrapped with MobX's `@observer` decorator
 * (`mobx-react` `makeClassComponentObserver`) attach an own-property `this.render` on
 * each component instance during its first render. That instance reaction captures the
 * class's original unpatched render function in a closure, bypassing subsequent prototype
 * method patches.
 *
 * By defining a getter/setter for `props` on the component's prototype:
 * 1. `super(e)` in the constructor sets `this.props = e`, invoking our prototype setter
 *    without creating an instance own-property.
 * 2. Any subsequent render (called directly or through MobX's instance reaction) accesses
 *    `this.props.overview`, invoking our prototype getter.
 * 3. The getter supplies a scoped Proxy where `BIsModOrShortcut: () => false` solely to
 *    the component, without touching `AppOverview.prototype` (preserving Guardrail 1).
 */
function hookComponentProps(
    componentClass: any,
    options: {
        requireMetadata?: boolean;
        /** Kill-switch id of the surface that owns this component (plan § 7.0 D6). */
        id: string;
    },
): void {
    if (
        !componentClass ||
        typeof componentClass !== "function" ||
        !componentClass.prototype
    ) {
        return;
    }
    if (componentClass.__nsga_props_hooked) return;
    componentClass.__nsga_props_hooked = true;

    try {
        Object.defineProperty(componentClass.prototype, "props", {
            get() {
                if (!deps.isEnabled(options.id)) return this._nsga_raw_props;
                try {
                    remember(this);
                    const rawProps = this._nsga_raw_props;
                    if (!rawProps) return rawProps;
                    const overview = rawProps.overview;
                    if (!overview) return rawProps;
                    ensureAppOverviewHooked(overview);

                    if (
                        isShortcutAppId(overview.appid) ||
                        (typeof overview.BIsModOrShortcut === "function" &&
                            overview.BIsModOrShortcut())
                    ) {
                        const rawAppid = overview.appid >>> 0;

                        if (options.requireMetadata) {
                            const store = getAppDetailsStore();
                            let appData =
                                store?.GetAppData?.(overview.appid) ||
                                store?.GetAppData?.(rawAppid);

                            if (
                                !appData?.descriptionsData?.strSnippet &&
                                onGetMetadata &&
                                onEnrichGameDetails
                            ) {
                                const meta =
                                    onGetMetadata(rawAppid) ||
                                    onGetMetadata(overview.appid);
                                if (meta) {
                                    onEnrichGameDetails(rawAppid, meta);
                                    appData =
                                        store?.GetAppData?.(overview.appid) ||
                                        store?.GetAppData?.(rawAppid);
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

                            if (!hasMetadata) {
                                return rawProps;
                            }
                        }

                        if (
                            this._nsga_patched_props &&
                            this._nsga_last_raw_props === rawProps
                        ) {
                            return this._nsga_patched_props;
                        }
                        this._nsga_last_raw_props = rawProps;
                        this._nsga_patched_props = new Proxy(rawProps, {
                            get(target, prop, receiver) {
                                if (prop === "overview") {
                                    return createPatchedOverview(overview);
                                }
                                return Reflect.get(target, prop, receiver);
                            },
                        });
                        return this._nsga_patched_props;
                    }
                    return rawProps;
                } catch (err) {
                    deps.reportError(options.id, err); // fail-open (plan § 7.0 D6)
                    return this._nsga_raw_props;
                }
            },
            set(newProps) {
                this._nsga_raw_props = newProps;
                this._nsga_last_raw_props = undefined;
                this._nsga_patched_props = undefined;
            },
            configurable: true,
        });
    } catch (e) {
        logger.warn("Could not define props descriptor on component:", e);
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

    // 1. Prototype props descriptor (intercepts both MobX instance reactions and normal renders)
    hookComponentProps(k, { requireMetadata: true, id: "game-info" });

    // 2. Wrap k.prototype.render as secondary fallback
    const origKRender = k.prototype.render;
    if (typeof origKRender === "function") {
        k.prototype.render = function () {
            if (!deps.isEnabled("game-info")) return origKRender.apply(this, arguments);
            try {
                remember(this);
                const overview = this.props?.overview;
                if (overview) {
                    ensureAppOverviewHooked(overview);
                }
                if (
                    overview &&
                    (isShortcutAppId(overview.appid) ||
                        (typeof overview.BIsModOrShortcut === "function" &&
                            overview.BIsModOrShortcut()))
                ) {
                    const rawAppid = overview.appid >>> 0;
                    const store = getAppDetailsStore();
                    let appData =
                        store?.GetAppData?.(overview.appid) ||
                        store?.GetAppData?.(rawAppid);

                    // Every render re-checks: enrichGameDetails is a no-op while our data is
                    // live, and re-applies once after Steam rebuilds the overview (M0a).
                    if (onGetMetadata && onEnrichGameDetails) {
                        const meta =
                            onGetMetadata(rawAppid) || onGetMetadata(overview.appid);
                        if (meta) {
                            onEnrichGameDetails(rawAppid, meta);
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
            } catch (err) {
                deps.reportError("game-info", err); // fail-open (plan § 7.0 D6)
            }

            return origKRender.apply(this, arguments);
        };
    }

    logger.info(
        "Successfully patched Steam Game Info inner component (k.prototype.props & render).",
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
        const req = steamRequire() as ((id: string) => any) & { m: Record<string, unknown> } | undefined;
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
                        !targetG &&
                        typeof proto.onCollapseStarted === "function" &&
                        typeof proto.onCollapseComplete === "function" &&
                        typeof proto.setBoxHeight === "function"
                    ) {
                        targetG = exp;
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

        // 2. Hook targetG (prototype props descriptor + render fallback)
        if (!targetG.__nsga_g_patched) {
            targetG.__nsga_g_patched = true;
            hookComponentProps(targetG, {
                requireMetadata: true,
                id: "game-info",
            });

            const origGRender = targetG.prototype.render;
            if (typeof origGRender === "function") {
                targetG.prototype.render = function () {
                    if (!deps.isEnabled("game-info")) return origGRender.apply(this, arguments);
                    try {
                        remember(this);
                        const overview = this.props?.overview;
                        if (overview) {
                            ensureAppOverviewHooked(overview);
                        }
                        if (
                            overview &&
                            (isShortcutAppId(overview.appid) ||
                                (typeof overview.BIsModOrShortcut === "function" &&
                                    overview.BIsModOrShortcut()))
                        ) {
                            const rawAppid = overview.appid >>> 0;

                            const store = getAppDetailsStore();
                            let appData =
                                store?.GetAppData?.(overview.appid) ||
                                store?.GetAppData?.(rawAppid);

                            // Every render re-checks: enrichGameDetails is a no-op while our data is
                            // live, and re-applies once after Steam rebuilds the overview (M0a).
                            if (
                                onGetMetadata &&
                                onEnrichGameDetails
                            ) {
                                const meta =
                                    onGetMetadata(rawAppid) ||
                                    onGetMetadata(overview.appid);
                                if (meta) {
                                    onEnrichGameDetails(rawAppid, meta);
                                    appData =
                                        store?.GetAppData?.(overview.appid) ||
                                        store?.GetAppData?.(rawAppid);
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
                    } catch (err) {
                        deps.reportError("game-info", err); // fail-open (plan § 7.0 D6)
                    }

                    const vdom = origGRender.apply(this, arguments);
                    try {
                        const kChild = vdom?.props?.children?.[0]?.type;
                        if (kChild) {
                            patchKComponent(kChild);
                        }
                    } catch (err) {
                        deps.reportError("game-info", err);
                    }
                    return vdom;
                };
            }
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
