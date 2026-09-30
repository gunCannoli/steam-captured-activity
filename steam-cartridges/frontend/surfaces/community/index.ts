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
import {
    cardElement,
    CREATOR_AVATARS,
    CREATOR_NAMES,
    CREATOR_STEAMIDS,
    isContentSection,
    isPlaceholderAppIcon,
    loaderAnswer,
    shouldLoadFirstPage,
    sourceOfAccount,
    toFeedItems,
    type FeedItem,
} from "./core";

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

/** What the image viewer needs to show "Created by" and a date for one of our images (by the URL the card opens). */
interface ViewerMeta {
    source: MediaItem["source"];
    seconds: number;
}
const viewerMeta = new Map<string, ViewerMeta>();
const viewerUrlsByApp = new Map<number, string[]>();
let cardsHook: ReturnType<typeof keepJsxPatched> | undefined;
let cardsHidden = 0;
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

/** A component that renders nothing (Steam's vote, award, comment and Report controls on our cards). */
const Nothing = (): null => null;
type Wrapper = (props: Record<string, any>) => unknown;
const wrappers = new WeakMap<object, Wrapper>();
function wrapped(type: object, make: (type: any) => Wrapper): Wrapper {
    let w = wrappers.get(type); // one stable component per Steam type: a new one each render would remount the subtree
    if (!w) {
        w = make(type);
        wrappers.set(type, w);
    }
    return w;
}

function accountOfPersona(persona: any): number | undefined {
    const id = persona?.m_steamid;
    return typeof id?.GetAccountID === "function" ? id.GetAccountID() : undefined;
}

/**
 * Steam's own components for our cards and their image viewer, adjusted for content Valve does not know
 * (ADR-0046): no vote, award, comment or Report controls; the viewer gets a creator and a date, and no comment thread;
 * the made-up creator accounts show the source's name and icon. Every check is a few property reads (guardrail 2).
 */
function installCards(): void {
    if (cardsHook) return;
    const runtime = jsxRuntime();
    if (!runtime) {
        logger.warn("react/jsx-runtime not found; Steam's card controls stay on our cards.");
        return;
    }
    const jsx = (type: unknown, props: Record<string, unknown>) => (runtime.jsx as (t: unknown, p: unknown) => unknown)(type, props);
    cardsHook = keepJsxPatched(runtime, {
        label: "steam-cartridges.community-cards",
        replaceType: (type, props) => {
            try {
                const p = props as Record<string, any> | null | undefined;
                if (!p || typeof p !== "object") return undefined;
                if (typeof type === "string") return isPlaceholderAppIcon(type, p) && deps.isEnabled("community") ? "span" : undefined;
                // 1. our cards' controls and gamepad menu
                const card = cardElement(p);
                if (card === "hide") {
                    if (!deps.isEnabled("community")) return undefined;
                    cardsHidden++;
                    return Nothing;
                }
                if (card === "strip-menu") {
                    return deps.isEnabled("community")
                        ? wrapped(type as object, (T) => (q) => jsx(T, { ...q, onMenuButton: undefined, onMenuActionDescription: undefined }))
                        : undefined;
                }
                // 2. the image viewer Steam opens on a click: the creator and date row, and no comment thread for an unknown file
                if (typeof p.artworkURL === "string" && p.file_details === undefined && viewerMeta.has(p.artworkURL)) {
                    if (!deps.isEnabled("community")) return undefined;
                    return wrapped(type as object, (T) => (q) => {
                        const meta = viewerMeta.get(q.artworkURL);
                        if (!meta) return jsx(T, q);
                        return jsx(T, {
                            ...q,
                            children: undefined,
                            // No appid: Steam would look up app info for a non-Steam app and assert (verified live 2026-09-30).
                            appid: undefined,
                            file_details: { creator: CREATOR_STEAMIDS[meta.source], time_created: meta.seconds, file_description: "" },
                        });
                    });
                }
                // 3. "Created by": the avatar and the name of our made-up accounts
                if (p.friend !== undefined && sourceOfAccount(p.friend?.m_unAccountID)) {
                    return wrapped(type as object, () => (q) =>
                        jsx("img", {
                            src: CREATOR_AVATARS[sourceOfAccount(q.friend?.m_unAccountID) ?? "igdb"],
                            style: { width: 36, height: 36, borderRadius: 4 },
                        }),
                    );
                }
                if (p.persona !== undefined && "bParenthesizeNicknames" in p && sourceOfAccount(accountOfPersona(p.persona))) {
                    return wrapped(type as object, () => (q) =>
                        jsx("span", { className: q.className, children: CREATOR_NAMES[sourceOfAccount(accountOfPersona(q.persona)) ?? "igdb"] }),
                    );
                }
            } catch (err) {
                deps.reportError("community", err); // fail-open: Steam's own element
            }
            return undefined;
        },
    });
}

function forgetViewerMeta(appid: number): void {
    for (const url of viewerUrlsByApp.get(appid) ?? []) viewerMeta.delete(url);
    viewerUrlsByApp.delete(appid);
}

/** The viewer opens the image a card shows: remember which source and date belong to that URL. Videos open YouTube instead. */
function rememberViewerMeta(appid: number, feed: FeedItem[], checkedAtMs: number): void {
    forgetViewerMeta(appid);
    const urls: string[] = [];
    const seconds = Math.floor(checkedAtMs / 1000);
    for (const card of feed) {
        if (card.type === 4) continue;
        const source = (Object.keys(CREATOR_STEAMIDS) as MediaItem["source"][]).find((s) => CREATOR_STEAMIDS[s] === card.creator.steamid);
        if (!source) continue;
        viewerMeta.set(card.full_image_url, { source, seconds });
        urls.push(card.full_image_url);
    }
    viewerUrlsByApp.set(appid, urls);
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
export function communityDiagnostics(): {
    patched: boolean;
    feeds: Record<number, number>;
    served: number;
    firstPageLoads: number;
    cardsHidden: number;
    cardsHook: boolean;
    jsx: JsxHookDiagnostics[];
} {
    const counts: Record<number, number> = {};
    feeds.forEach((feed, appid) => (counts[appid] = feed.length));
    return { patched: !!unpatchLoader, feeds: counts, served, firstPageLoads, cardsHidden, cardsHook: !!cardsHook, jsx: hook?.diagnostics() ?? lastJsx };
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
                forgetViewerMeta(appid);
                feeds.delete(appid);
                return;
            }
            const feed = toFeedItems(appid, items, (key) => deps.imageOf(appid, key));
            feeds.set(appid, feed);
            rememberViewerMeta(appid, feed, typeof media?.checkedAt === "number" ? media.checkedAt : Date.now());
            installCards();
        },
        clear: (appid) => {
            forgetViewerMeta(appid);
            feeds.delete(appid);
        },
        uninstall() {
            unpatchLoader?.();
            unpatchLoader = undefined;
            hook?.dispose();
            hook = undefined;
            cardsHook?.dispose();
            cardsHook = undefined;
            learnScheduled = false;
            feeds.clear();
            viewerMeta.clear();
            viewerUrlsByApp.clear();
        },
    };
}
