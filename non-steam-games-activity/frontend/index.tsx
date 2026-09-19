import { Steam } from 'steambrew-utils';
import { onAppLaunch, onLocationChange, onPopupCreate, PopupType } from 'steambrew-utils/watchers';
import { clearAssetCache } from './assets';
import { logger } from './logger';
import { patch as patchLibraryApp, refresh as refreshLibraryApp, unpatch as unpatchLibraryApp } from './renderers/library-app';
import { rpc } from './rpc';

/**
 * Steam assigns non-Steam shortcuts appids at the top of the 32-bit range.
 * Mirrors the backend's NON_STEAM_APPID_MIN.
 */
const NON_STEAM_APPID_MIN = 0x8000_0000;

/** `/library/app/4263274102` (and Big Picture's `/tab/<Name>` variants). */
function appIdFromPath(pathname: string): number | undefined {
  const match = /^\/library\/app\/(\d+)/.exec(pathname);
  if (!match?.[1]) return undefined;

  const appid = Number(match[1]);
  return Number.isFinite(appid) ? appid : undefined;
}

export default async function OnPluginLoaded() {
  try {
    const diagnostics = await rpc.getDiagnostics();
    if (!diagnostics.ok) {
      logger.error('Backend could not read Steam:', diagnostics.error);
      return;
    }
    logger.info(
      `Ready. ${diagnostics.shortcuts} shortcuts, ` +
        `${diagnostics.screenshots} screenshots across ` +
        `${diagnostics.games_with_media} non-Steam games.`,
    );
  } catch (error) {
    logger.error('Failed to reach the backend:', error);
    return;
  }

  // ===== App detail pages =====
  // Each Steam window is its own document, so watch them individually.

  onPopupCreate((popup, type) => {
    // Big Picture (PopupType.Gamepad) needs its own renderer and its own class
    // modules; desktop ships first (ADR-0016).
    if (type !== PopupType.Desktop) return;

    const stopWatching = onLocationChange(
      () => Steam.MainWindowBrowserManager?.m_lastLocation,
      ({ pathname }) => {
        const window = popup.window;
        if (!window) return;

        const appid = appIdFromPath(pathname);
        if (appid !== undefined && appid >= NON_STEAM_APPID_MIN) {
          void patchLibraryApp(window, appid);
        } else {
          // Either a native Steam game, which we leave alone, or another page.
          unpatchLibraryApp(window);
        }
      },
    );

    return () => {
      stopWatching();
      if (popup.window) unpatchLibraryApp(popup.window);
    };
  });

  // ===== Refresh after play =====
  // Quitting a game is exactly when new screenshots and clips exist, so
  // invalidate then rather than polling (ADR-0007).

  onAppLaunch((app, { onQuit }) => {
    if (app.appid < NON_STEAM_APPID_MIN) return;

    onQuit(() => {
      logger.info(`${app.display_name} closed; refreshing its activity.`);
      clearAssetCache();
      void refreshLibraryApp(app.appid);
    });
  });
}
