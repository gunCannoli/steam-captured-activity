import { findModuleByExport } from "@steambrew/client";
import { logger } from "../../logger";
import { keepJsxPatched, type JsxHookDiagnostics } from "../../steam/jsx-hook";
import { getSteamRequire } from "../game-info/game-info-patch";
import { redirectProps, type RedirectKind } from "./native-sections-core";

/**
 * Hands Steam's own Links, Friends and Community sections the native appid of
 * a mapped shortcut (parity plan C; pure logic in native-sections-core.ts).
 *
 * The three components are resolved ONCE at startup (guardrail 3) by their
 * webpack factory source, keyed on localisation tokens (steam-debug.md § 3.2).
 * Each signature must match exactly one module, or that kind is skipped and
 * the section stays stock. Verified 2026-09-24: links -> module exporting the
 * links bar used by desktop and Big Picture Game Info; friends -> the module
 * with the Friends section (desktop `{details}`, Big Picture `{details}`);
 * community -> the Community Content section (`{appid}`).
 *
 * The jsx handler is O(1) (guardrail 2): one Map lookup on the element type,
 * then one on the appid.
 */
const SIGNATURES: [RedirectKind, string[]][] = [
    ["links", ['"#AppDetails_Links_Store"', '"primarylinks"']],
    ["friends", ['"CommunityFriendsThatPlay"', '"#AppDetails_SectionTitle_Friends"']],
    ["community", ['"#AppDetails_SectionTitle_Community"', "LoadAdditionalContent"]],
];

/** Element type -> kind. Every export of a matched module (only matching props are touched). */
const TYPES = new Map<unknown, RedirectKind>();
/** Shortcut appid -> native appid, for mapped steam-store games. */
const nativeFor = new Map<number, number>();
const counts: Record<RedirectKind, number> = { links: 0, friends: 0, community: 0 };
const lastNative: Partial<Record<RedirectKind, number>> = {};

export function setNativeAppid(appid: number, nativeAppid: number | undefined): void {
    if (nativeAppid === undefined) nativeFor.delete(appid);
    else nativeFor.set(appid, nativeAppid);
}

const nativeOf = (appid: number) => nativeFor.get(appid);

function resolveTypes(): void {
    const req = getSteamRequire();
    if (!req?.m) {
        logger.warn("Webpack require unavailable; native sections stay stock.");
        return;
    }
    const hits: Record<RedirectKind, string[]> = { links: [], friends: [], community: [] };
    for (const id of Object.keys(req.m)) {
        let src: string;
        try {
            src = Function.prototype.toString.call(req.m[id]);
        } catch {
            continue;
        }
        for (const [kind, needles] of SIGNATURES) {
            if (needles.every((n) => src.includes(n))) hits[kind].push(id);
        }
    }
    for (const [kind] of SIGNATURES) {
        if (hits[kind].length !== 1) {
            logger.warn(`Native ${kind} section: ${hits[kind].length} module matches (need 1); left stock.`);
            continue;
        }
        let exp: any;
        try {
            exp = req(hits[kind][0]!);
        } catch {
            continue;
        }
        for (const key of Object.keys(exp ?? {})) {
            const v = exp[key];
            if (v && (typeof v === "function" || typeof v === "object")) TYPES.set(v, kind);
        }
    }
}

function findJsxRuntime(): Record<"jsx" | "jsxs", (type: unknown, props: unknown, key?: unknown) => unknown> | undefined {
    const found = findModuleByExport(
        (moduleExport: unknown, exportName?: unknown) =>
            (exportName === "jsx" || exportName === "jsxs") && typeof moduleExport === "function",
    ) as any;
    return found && typeof found.jsx === "function" && typeof found.jsxs === "function" ? found : undefined;
}

let hook: ReturnType<typeof keepJsxPatched> | undefined;

/** Resolve the components and install the jsx handler. Idempotent; a failure leaves Steam stock. */
export function installNativeSections(): void {
    if (hook) return;
    try {
        resolveTypes();
        if (TYPES.size === 0) return;
        const runtime = findJsxRuntime();
        if (!runtime) {
            logger.warn("Could not find react/jsx-runtime; native sections stay stock.");
            return;
        }
        hook = keepJsxPatched(runtime, {
            label: "steam-cartridges.native-sections",
            observe: (type, props) => {
                const kind = TYPES.get(type);
                if (kind === undefined) return;
                const used = redirectProps(kind, props as Record<string, any>, nativeOf);
                if (used !== undefined) {
                    counts[kind]++;
                    lastNative[kind] = used;
                }
            },
        });
        logger.info(`Native sections redirect installed (${TYPES.size} component exports).`);
    } catch (err) {
        logger.warn("Native sections redirect failed; sections stay stock.", err);
    }
}

/** For CDP checks (PLUGIN_LIST[...].nativeSectionsDiagnostics()). */
export function nativeSectionsDiagnostics(): {
    kinds: RedirectKind[];
    counts: Record<RedirectKind, number>;
    lastNative: Partial<Record<RedirectKind, number>>;
    mapped: Record<number, number>;
    jsx: JsxHookDiagnostics[];
} {
    return {
        kinds: [...new Set(TYPES.values())],
        counts: { ...counts },
        lastNative: { ...lastNative },
        mapped: Object.fromEntries(nativeFor),
        jsx: hook?.diagnostics() ?? [],
    };
}
