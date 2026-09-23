import { beforePatch, findModuleByExport } from '@steambrew/client';
import { logger } from '../logger';

/**
 * Non-Steam appid boundary.
 */
const NON_STEAM_APPID_MIN = 0x8000_0000;

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

let runtime: JsxRuntimeModule | undefined;
let isInstalled = false;

function handleHeadlineIntercept(args: unknown[]): void {
  const props = args[1] as EventHeadlineProps | undefined;
  if (!props || !props.event || !props.steamIDActor || typeof props.children !== 'string') {
    return;
  }

  const appid = props.event.appid ?? Number(props.event.gameid);
  if (props.event.bIsNonSteam || (typeof appid === 'number' && appid >= NON_STEAM_APPID_MIN)) {
    // Steam's EventHeadline renders:
    // <span className="ActorName">{persona}</span><span className="HeaderChildren">{children}</span>
    // Replacing UGC string (" shared X screenshots") with " captured" aligns with native phrasing (" achieved").
    args[1] = { ...props, children: ' captured' };
  }
}

/**
 * Patch react/jsx-runtime to refine the Activity Feed headline for non-Steam games.
 *
 * Replaces community UGC phrasing ("cannoliGun shared 2 screenshots") with native action phrasing
 * ("cannoliGun captured").
 */
export function installHeadlinePatch(): void {
  if (isInstalled) return;

  runtime = findJsxRuntime();
  if (!runtime) {
    logger.warn('Could not find react/jsx-runtime; activity headline patch skipped.');
    return;
  }

  beforePatch(runtime, 'jsx', (args) => handleHeadlineIntercept(args));
  beforePatch(runtime, 'jsxs', (args) => handleHeadlineIntercept(args));
  isInstalled = true;
  logger.info('Installed Activity Feed headline patch ("{Username} captured").');
}
