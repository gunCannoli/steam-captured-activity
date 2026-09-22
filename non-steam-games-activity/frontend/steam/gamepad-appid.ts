import { beforePatch, findModuleByExport } from '@steambrew/client';
import { logger } from '../logger';

/**
 * Detects which app Big Picture's app-details view is currently showing.
 *
 * ADR-0025 fixed a bug in the original signal (watching `location` on the
 * wrong window). ADR-0026 then found the fix wasn't enough: Big Picture's
 * real navigation — confirmed live with genuine gamepad-style input, not
 * synthetic navigation — never changes `location` on *any* window. Opening a
 * game's app-details page is an in-place view swap, not a route change, so
 * no `Location` object can ever reflect it.
 *
 * ADR-0027's replacement, implemented here: `react/jsx-runtime` is a shared
 * vendor module — one instance used by both `SharedJSContext`'s own bundle
 * and Big Picture's separate one. (`window.webpackChunksteamui` is still
 * confirmed `undefined` inside the Big Picture popup — Steam's *own* app
 * code, the section registry, `CAppDetailsSections`, is still genuinely
 * bundle-local. Only this generic dependency is shared.) Patching its `jsx`
 * export from `SharedJSContext` intercepts every element Big Picture's own
 * React creates, including ones carrying the current page's `appid` as a
 * prop — verified live: 9,500+ intercepted calls from Big-Picture-only
 * input, and the real `appid` read off captured props the instant a game's
 * detail page rendered.
 *
 * The filter is the part that took real verification. `'appid' in props`
 * alone is far too broad — live-tested, it also matches: a "recommended
 * games" carousel (dozens of unrelated appids per render), a "friends
 * playing" widget (one per friend, any currently-played game), and a page
 * pager tracking `previousAppid`/`preloadAppid` for fast back-navigation.
 * `props.rgSections` narrows it to the one component that receives the
 * page's section list alongside its appid — matching this codebase's own
 * `CAppDetailsSections`/section-registry naming elsewhere
 * (steam-components.md). Verified live, twice, on two different non-Steam
 * games: exactly one match per navigation, the correct appid both times,
 * zero matches while just arrow-key-browsing the library grid. The
 * intercepted function's own `.name` is deliberately NOT part of the
 * filter — minified names collide across genuinely different components
 * (the same one-letter name that matched `rgSections` also matched an
 * unrelated "friend + playtime" widget on a different render); only the
 * shape of `props` is trustworthy.
 *
 * Scope, honestly stated: this detects *entering* an app-details page. It
 * does not detect *leaving* one back to the library grid — no signal for
 * that was found or is needed yet, since `gamepad-app.tsx`'s `patch()` is
 * idempotent (it unpatches before re-rendering) and a stale strip left
 * behind after backing out is a minor, disclosed limitation, not a crash.
 * See CHANGELOG.md.
 */

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

/**
 * Install (or re-install) the interception. Idempotent per current runtime
 * reference; re-checked on a slow interval because Steam has been observed
 * (by a third-party plugin using this same technique on desktop, not yet
 * independently confirmed on this codebase's own build) to occasionally
 * swap or drop a patched reference around the first game launch of a
 * session. Re-detecting is cheap — it only re-reads two already-resolved
 * function references, not a full module-cache rescan — so polling for it
 * is not worth avoiding.
 */
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

/**
 * Notify `onAppid` whenever Big Picture's app-details view renders with a
 * new appid (Steam or non-Steam — callers filter). Returns an unsubscribe
 * function. Safe to call from multiple places; the underlying patch is
 * installed once and shared.
 */
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
