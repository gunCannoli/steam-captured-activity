import { beforePatch, findModuleByExport } from '@steambrew/client';
import { logger } from '../logger';

interface JsxRuntimeModule {
  jsx(type: unknown, props: unknown, key?: unknown): unknown;
  jsxs(type: unknown, props: unknown, key?: unknown): unknown;
}

interface AppDetailsProps {
  appid: number;
  rgSections: unknown[];
}

function isAppDetailsProps(props: unknown): props is AppDetailsProps {
  if (!props || typeof props !== 'object') return false;
  const p = props as Record<string, unknown>;
  return typeof p.appid === 'number' && Array.isArray(p.rgSections);
}

function findJsxRuntime(): JsxRuntimeModule | undefined {
  const found = findModuleByExport(
    (moduleExport: unknown, exportName?: unknown) =>
      (exportName === 'jsx' || exportName === 'jsxs') && typeof moduleExport === 'function',
  ) as JsxRuntimeModule | undefined;

  if (!found || typeof found.jsx !== 'function' || typeof found.jsxs !== 'function') return undefined;
  return found;
}

const listeners = new Set<(appid: number) => void>();

function notify(appid: number): void {
  for (const listener of listeners) {
    try {
      listener(appid);
    } catch (error) {
      logger.warn('Gamepad appid listener threw:', error);
    }
  }
}

function handleIntercepted(props: unknown): void {
  if (!isAppDetailsProps(props)) return;
  notify(props.appid);
}

let runtime: JsxRuntimeModule | undefined;
let patchedJsx: unknown;
let patchedJsxs: unknown;

function ensurePatched(): void {
  if (!runtime) {
    runtime = findJsxRuntime();
    if (!runtime) {
      logger.warn('Could not find react/jsx-runtime; Big Picture appid detection is unavailable.');
      return;
    }
  }

  if (runtime.jsx !== patchedJsx) {
    beforePatch(runtime, 'jsx', (args) => handleIntercepted(args[1]));
    patchedJsx = runtime.jsx;
  }
  if (runtime.jsxs !== patchedJsxs) {
    beforePatch(runtime, 'jsxs', (args) => handleIntercepted(args[1]));
    patchedJsxs = runtime.jsxs;
  }
}

let watchdog: ReturnType<typeof setInterval> | undefined;

export function watchGamepadAppid(onAppid: (appid: number) => void): () => void {
  ensurePatched();
  if (watchdog === undefined) {
    watchdog = setInterval(ensurePatched, 5000);
  }

  listeners.add(onAppid);
  return () => {
    listeners.delete(onAppid);
    if (listeners.size === 0 && watchdog !== undefined) {
      clearInterval(watchdog);
      watchdog = undefined;
    }
  };
}
