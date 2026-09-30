// Surface `community` (features plan F2, ADR-0046): Steam's own Community Content section (desktop section
// `community`, Big Picture COMMUNITY tab, both `wb({ appid })` of module 77163) shows a shortcut's community media as
// Steam's own cards. Pure logic in core.ts.
//
// Steam's loader (class `ae`, not exported) fetches `library/appcommunityfeed/<appid>` in
// `LoadCommunityContentAndVotes(appid, page)`. We patch that one prototype method: for a shortcut with a feed it returns
// ours (and no vote summary call); for everything else it calls Steam's. The class is reached once: a jsx observer
// learns the section class the first time Steam renders one (core.isContentSection), a timer then builds one throwaway
// section (constructor only: no mount, no request) to read its loader's prototype, patches it and disposes the hook.
// Verified live 2026-09-30 (435150): the element type is the class, a throwaway's loader shares the mounted one's
// prototype. The first page loads >= 1 s after the section mounts, so the patch is in place before it.
import { afterPatch, callOriginal, replacePatch } from "@steambrew/client";
import { logger } from "../../logger";
import type { ShortcutId } from "../../kernel/appid";
import type { MediaImage } from "../../kernel/media-bin";
import type { MediaItem } from "../../kernel/record";
import type { Surface, SurfaceDeps } from "../../kernel/surface";
import { keepJsxPatched, type JsxHookDiagnostics } from "../../steam/jsx-hook";
import { jsxRuntime } from "../../steam/modules";
import { isContentSection, loaderAnswer, shouldLoadFirstPage, toFeedItems, type FeedItem } from "./core";

export interface CommunityDeps extends SurfaceDeps {
    /** The object URL app/media put in the media bin for a ScreenScraper item (a pure read). */
    imageOf(appid: number, key: string): MediaImage | undefined;
}

/** Set by createCommunitySurface; open defaults until then. */
let deps: CommunityDeps = { isEnabled: () => true, reportError: () => {}, imageOf: () => undefined };

/** Shortcut appid -> its feed, from record.media (render). */
const feeds = new Map<number, FeedItem[]>();
let hook: ReturnType<typeof keepJsxPatched> | undefined;
let lastJsx: JsxHookDiagnostics[] = [];
let learnScheduled = false;
let unpatchLoader: (() => void) | undefined;
let firstPageLoads = 0;
let served = 0;

function patchLoader(section: new (props: unknown) => { m_loader?: object }): void {
    if (unpatchLoader) return;
    const probe = new section({ appid: 0, labelId: "" });
    const proto = probe.m_loader ? (Object.getPrototypeOf(probe.m_loader) as Record<string, unknown>) : undefined;
    if (!proto || typeof proto.LoadCommunityContentAndVotes !== "function") {
        throw new Error("Community Content loader has no LoadCommunityContentAndVotes; left stock.");
    }
    const patch = replacePatch(proto, "LoadCommunityContentAndVotes", function (args: unknown[]): unknown {
        if (!deps.isEnabled("community")) return callOriginal;
        try {
            const answer = loaderAnswer(args[0], args[1], (appid) => feeds.get(appid));
            if (!answer) return callOriginal;
            served++;
            return Promise.resolve(answer);
        } catch (err) {
            deps.reportError("community", err); // fail-open: Steam's own loader
            return callOriginal;
        }
    });
    // Load the first page when Steam binds or resizes the loader (see core.shouldLoadFirstPage): Steam's own triggers miss
    // when the observer's first callback comes after its 1 s timer. LoadAdditionalContent is guarded by Steam's state.
    const loadFirstPage = function (this: unknown, _args: unknown[], ret: unknown): unknown {
        try {
            const loader = this as { LoadAdditionalContent?: () => void; m_nNextPage?: unknown; m_bHasEmptyRows?: unknown; m_unAppID?: unknown };
            if (deps.isEnabled("community") && typeof loader.LoadAdditionalContent === "function" && shouldLoadFirstPage(loader, (appid) => feeds.has(appid))) {
                firstPageLoads++;
                loader.LoadAdditionalContent();
            }
        } catch (err) {
            deps.reportError("community", err); // fail-open: Steam's own triggers still run
        }
        return ret;
    };
    const bindPatch = typeof proto.OnBind === "function" ? afterPatch(proto, "OnBind", loadFirstPage) : undefined;
    const resizePatch = typeof proto.OnResize === "function" ? afterPatch(proto, "OnResize", loadFirstPage) : undefined;
    unpatchLoader = () => {
        for (const p of [resizePatch, bindPatch, patch]) p?.unpatch();
    };
    lastJsx = hook?.diagnostics() ?? [];
    hook?.dispose(); // learned: the jsx observer is not needed any more
    hook = undefined;
    logger.info("Community Content loader patched.");
}

/** Install the learn-once jsx observer. Idempotent; a failure leaves the section stock. */
export function installCommunity(): void {
    if (hook || unpatchLoader) return;
    const runtime = jsxRuntime();
    if (!runtime) throw new Error("react/jsx-runtime not found; community media stays off.");
    hook = keepJsxPatched(runtime, {
        label: "steam-cartridges.community",
        observe: (type, props) => {
            if (learnScheduled || !deps.isEnabled("community")) return;
            try {
                if (!isContentSection(type, props)) return;
                learnScheduled = true;
                // Never patch from inside Steam's render (D5): the next tick, well before the first page (>= 1 s).
                setTimeout(() => {
                    try {
                        patchLoader(type as new (props: unknown) => { m_loader?: object });
                    } catch (err) {
                        deps.reportError("community", err);
                        logger.warn("Community Content loader not patched; the section stays stock.", err);
                    }
                }, 0);
            } catch (err) {
                deps.reportError("community", err);
            }
        },
    });
}

/** For CDP checks (PLUGIN_LIST[...].communityDiagnostics()). */
export function communityDiagnostics(): { patched: boolean; feeds: Record<number, number>; served: number; firstPageLoads: number; jsx: JsxHookDiagnostics[] } {
    const counts: Record<number, number> = {};
    feeds.forEach((feed, appid) => (counts[appid] = feed.length));
    return { patched: !!unpatchLoader, feeds: counts, served, firstPageLoads, jsx: hook?.diagnostics() ?? lastJsx };
}

export function createCommunitySurface(d: CommunityDeps): Surface {
    deps = d;
    return {
        id: "community",
        touches: ["CommunityContentLoader.LoadCommunityContentAndVotes", "jsx:community-section"],
        reads: ["media"],
        install: installCommunity,
        render(appid: ShortcutId, record) {
            const media = record?.media;
            const items: MediaItem[] = media?.status === "ok" && Array.isArray(media.data?.items) ? media.data!.items : [];
            if (items.length === 0) {
                feeds.delete(appid);
                return;
            }
            feeds.set(appid, toFeedItems(appid, items, (key) => deps.imageOf(appid, key)));
        },
        clear: (appid) => void feeds.delete(appid),
        uninstall() {
            unpatchLoader?.();
            unpatchLoader = undefined;
            hook?.dispose();
            hook = undefined;
            learnScheduled = false;
            feeds.clear();
        },
    };
}
