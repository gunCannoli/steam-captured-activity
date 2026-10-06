import { jsxRuntime } from '../../steam/modules';
import { keepJsxPatched, type JsxHookDiagnostics } from '../../steam/jsx-hook';
import { logger } from '../../logger';
import { isShortcutAppId } from '../../kernel/appid';
import { deps } from './deps';

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

function handleHeadlineIntercept(_type: unknown, props: unknown): void {
  const p = props as EventHeadlineProps | undefined;
  if (!p || !p.event || !p.steamIDActor || typeof p.children !== 'string') {
    return;
  }

  // Steam's EventHeadline renders:
  // <span className="ActorName">{persona}</span><span className="HeaderChildren">{children}</span>
  // Replacing UGC string (" shared X screenshots") with " captured" aligns with native phrasing (" achieved").
  // Native events like AddedToLibrary (type 3) and PlayedFirstTime (type 30) retain Steam's native phrases.
  if (p.event.eEventType === 13 || p.event.eEventType === undefined) {
    const appid = p.event.appid ?? Number(p.event.gameid);
    const isShortcut = p.event.bIsNonSteam || (typeof appid === 'number' && isShortcutAppId(appid));
    const hasMediaItems = Array.isArray((p.event as any).m_mediaItems);
    const isScreenshotText = p.children.toLowerCase().includes('screenshot');

    if (isShortcut || hasMediaItems || isScreenshotText) {
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

  const runtime = jsxRuntime();
  if (!runtime) {
    logger.warn('Could not find react/jsx-runtime; activity headline patch skipped.');
    return;
  }

  hook = keepJsxPatched(runtime as unknown as Record<'jsx' | 'jsxs', (type: unknown, props: unknown, key?: unknown) => unknown>, {
    label: 'steam-cartridges.headline',
    observe: (type, props) => {
      if (!deps.isEnabled('headline')) return;
      try {
        handleHeadlineIntercept(type, props);
      } catch (err) {
        deps.reportError('headline', err); // fail-open (plan § 7.0 D6)
      }
    },
  });
  logger.info('Installed Activity Feed headline patch ("{Username} captured").');
}

/** Chain health, for tests (window.PLUGIN_LIST[...].headlineJsxDiagnostics()). */
export function headlineJsxDiagnostics(): JsxHookDiagnostics[] {
  return hook?.diagnostics() ?? [];
}
