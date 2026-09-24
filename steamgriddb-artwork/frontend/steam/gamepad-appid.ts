import { findModuleByExport } from "@steambrew/client";
import { keepJsxPatched, type JsxHookDiagnostics } from "./jsx-hook";
import { logger } from "../logger";

interface JsxRuntimeModule {
    jsx(type: unknown, props: unknown, key?: unknown): unknown;
    jsxs(type: unknown, props: unknown, key?: unknown): unknown;
}

interface AppDetailsProps {
    appid: number;
    rgSections: unknown[];
}

function isAppDetailsProps(props: unknown): props is AppDetailsProps {
    if (!props || typeof props !== "object") return false;
    const p = props as Record<string, unknown>;
    return typeof p.appid === "number" && Array.isArray(p.rgSections);
}

function findJsxRuntime(): JsxRuntimeModule | undefined {
    const found = findModuleByExport(
        (moduleExport: unknown, exportName?: unknown) =>
            (exportName === "jsx" || exportName === "jsxs") &&
            typeof moduleExport === "function",
    ) as JsxRuntimeModule | undefined;

    if (
        !found ||
        typeof found.jsx !== "function" ||
        typeof found.jsxs !== "function"
    )
        return undefined;
    return found;
}

const listeners = new Set<(appid: number) => void>();

function notify(appid: number): void {
    for (const listener of listeners) {
        try {
            listener(appid);
        } catch (error) {
            logger.warn("Gamepad appid listener threw:", error);
        }
    }
}

function handleIntercepted(props: unknown): void {
    if (!isAppDetailsProps(props)) return;
    notify(props.appid);
}

let hook: ReturnType<typeof keepJsxPatched> | undefined;

/**
 * Install the interception once. Self-healing and shared safely with the other
 * plugins that hook jsx (steam/jsx-hook.ts): re-installs only when no longer
 * anywhere in the chain, instead of re-wrapping whenever another plugin's
 * patch sits on top (the old pattern here, which grew the shared chain
 * without bound).
 */
function ensurePatched(): void {
    if (hook) return;
    const runtime = findJsxRuntime();
    if (!runtime) {
        logger.warn(
            "Could not find react/jsx-runtime; Big Picture appid detection is unavailable.",
        );
        return;
    }
    hook = keepJsxPatched(runtime as unknown as Record<'jsx' | 'jsxs', (type: unknown, props: unknown, key?: unknown) => unknown>, {
        label: "steamgriddb-artwork",
        observe: (_type, props) => handleIntercepted(props),
    });
}

/** Chain health, for tests (window.PLUGIN_LIST[...].jsxDiagnostics()). */
export function jsxDiagnostics(): JsxHookDiagnostics[] {
    return hook?.diagnostics() ?? [];
}

export function watchGamepadAppid(
    onAppid: (appid: number) => void,
): () => void {
    ensurePatched();
    listeners.add(onAppid);
    return () => {
        listeners.delete(onAppid);
    };
}
