import { Steam } from 'steambrew-utils';
import { onAppLaunch, onLocationChange, onPopupCreate, PopupType } from 'steambrew-utils/watchers';
import { logger } from './logger';
import {
  patch as patchLibraryApp,
  refresh as refreshLibraryApp,
  register as registerLibraryApp,
  unpatch as unpatchLibraryApp,
} from './renderers/library-app';
import { refresh as refreshLibraryHome, register as registerLibraryHome } from './renderers/library-home';
import { watchGamepadAppid } from './steam/gamepad-appid';

export { registerSummaryProvider } from './steam/summary';
export type { SummaryContext, SummaryContribution, SummaryProvider } from './steam/summary';

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
  // ===== Native sections =====
  // Steam hides Post-Game Summary from shortcuts with an app-type filter in its
  // section registry. Putting the name back is what makes the native component
  // render at all, so nothing else matters if this fails.
  if (!registerLibraryApp()) {
    logger.error('Could not restore Steam\'s app detail sections; summaries are unavailable.');
  }

  // ===== Library grid =====
  // Fills in last-played dates Steam does not have, from capture timestamps.
  await registerLibraryHome();

  // ===== App detail pages =====
  // Publishing is keyed on the app, not the window: Steam's store is global, so
  // one publish serves every window showing that game.

  onPopupCreate((_popup, type) => {
    if (type === PopupType.Desktop) {
      // Desktop feeds Steam's own store (steam/summary.ts) - Steam's own
      // component renders in whichever window is open, so this is global,
      // not per-window.
      let current: number | undefined;

      const stopWatching = onLocationChange(
        () => Steam.MainWindowBrowserManager?.m_lastLocation,
        ({ pathname }) => {
          const appid = appIdFromPath(pathname);

          if (appid !== undefined && appid >= NON_STEAM_APPID_MIN) {
            current = appid;
            void patchLibraryApp(appid);
          } else if (current !== undefined) {
            // Either a native Steam game, which we leave alone, or another page.
            unpatchLibraryApp(current);
            current = undefined;
          }
        },
      );

      return () => {
        stopWatching();
        if (current !== undefined) unpatchLibraryApp(current);
      };
    }

    if (type === PopupType.Gamepad) {
      // Big Picture renders through a React portal from SharedJSContext
      // into the gamepad popup window (ADR-0029). Both UI modes share the
      // same store singletons, webpack chunks, and CAppDetailsSections registry.
      //
      // Because Ge.T (module 53074) is already built into Big Picture's
      // "ACTIVITY" tab, feeding appSpotlightStore via patchLibraryApp(appid)
      // makes Steam render its genuine native GamePlaySummaryContainer with
      // controller focus rings and carousel scrolling automatically.
      let current: number | undefined;

      const stopWatching = watchGamepadAppid((appid) => {
        if (appid >= NON_STEAM_APPID_MIN) {
          if (current !== undefined && current !== appid) {
            unpatchLibraryApp(current);
          }
          current = appid;
          void patchLibraryApp(appid);
        } else if (current !== undefined) {
          unpatchLibraryApp(current);
          current = undefined;
        }
      });

      return () => {
        stopWatching();
        if (current !== undefined) unpatchLibraryApp(current);
      };
    }

    // Modal, ContextMenu, Unknown: not a page we touch.
    return undefined;
  });

  // ===== Refresh after play =====
  // Quitting a game is exactly when new screenshots and clips exist, so
  // invalidate then rather than polling (ADR-0007).

  onAppLaunch((app, { onQuit }) => {
    if (app.appid < NON_STEAM_APPID_MIN) return;

    onQuit(() => {
      logger.info(`${app.display_name} closed; refreshing its activity.`);
      void refreshLibraryApp(app.appid);
      void refreshLibraryHome();
    });
  });

  logger.info('Ready. Non-Steam games now use Steam\'s own detail sections.');
}
