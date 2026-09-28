import { findModuleByExport } from '@steambrew/client';
import { keepJsxPatched, type JsxHookDiagnostics } from './jsx-hook';
import { logger } from '../logger';
import { isNonSteamAppId } from './route';

interface JsxRuntimeModule {
  jsx(type: unknown, props: unknown, key?: unknown): unknown;
  jsxs(type: unknown, props: unknown, key?: unknown): unknown;
}

interface EventHeadlineProps {
  id?: string;
  focusable?: boolean;
  steamIDActor?: unknown;
  event?: {
    appid?: number;
    gameid?: string | number;
    bIsNonSteam?: boolean;
    eEventType?: number;
  };
  children?: unknown;
}

function findJsxRuntime(): JsxRuntimeModule | undefined {
  const found = findModuleByExport(
    (moduleExport: unknown, exportName?: unknown) =>
      (exportName === 'jsx' || exportName === 'jsxs') && typeof moduleExport === 'function',
  ) as JsxRuntimeModule | undefined;

  if (!found || typeof found.jsx !== 'function' || typeof found.jsxs !== 'function') return undefined;
  return found;
}

function handleHeadlineIntercept(_type: unknown, props: unknown): void {
  const p = props as EventHeadlineProps | undefined;
  if (!p || !p.event || !p.steamIDActor || typeof p.children !== 'string') {
    return;
  }

  const appid = p.event.appid ?? Number(p.event.gameid);
  if (p.event.bIsNonSteam || (typeof appid === 'number' && isNonSteamAppId(appid))) {
    // Steam's EventHeadline renders:
    // <span className="ActorName">{persona}</span><span className="HeaderChildren">{children}</span>
    // Replacing UGC string (" shared X screenshots") with " captured" aligns with native phrasing (" achieved").
    // Native events like AddedToLibrary (type 3) and PlayedFirstTime (type 30) retain Steam's native phrases.
    if (p.event.eEventType === 13 || p.event.eEventType === undefined) {
      Object.assign(p, { children: ' captured' });
    }
  }
}

let hook: ReturnType<typeof keepJsxPatched> | undefined;

/**
 * Patch react/jsx-runtime to refine the Activity Feed headline for non-Steam games.
 *
 * Replaces community UGC phrasing ("cannoliGun shared 2 screenshots") with native action phrasing
 * ("cannoliGun captured"). Self-healing and shared safely with the other plugins that hook jsx
 * (steam/jsx-hook.ts).
 */
export function installHeadlinePatch(): void {
  if (hook) return;

  const runtime = findJsxRuntime();
  if (!runtime) {
    logger.warn('Could not find react/jsx-runtime; activity headline patch skipped.');
    return;
  }

  hook = keepJsxPatched(runtime as unknown as Record<'jsx' | 'jsxs', (type: unknown, props: unknown, key?: unknown) => unknown>, {
    label: 'steam-cartridges.headline',
    observe: (type, props) => handleHeadlineIntercept(type, props),
  });
  logger.info('Installed Activity Feed headline patch ("{Username} captured").');
}

/** Chain health, for tests (window.PLUGIN_LIST[...].headlineJsxDiagnostics()). */
export function headlineJsxDiagnostics(): JsxHookDiagnostics[] {
  return hook?.diagnostics() ?? [];
}
