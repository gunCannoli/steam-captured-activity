import { Steam } from 'steambrew-utils';
import { onAppLaunch, onLocationChange, onPopupCreate, PopupType } from 'steambrew-utils/watchers';
import { logger } from './logger';
import {
  patch as patchGamepadApp,
  refresh as refreshGamepadApp,
  unpatch as unpatchGamepadApp,
} from './renderers/gamepad-app';
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

  onPopupCreate((popup, type) => {
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
      // Big Picture cannot be fed the same way: it is a separate webpack
      // bundle with its own module cache, so steam/summary.ts's patched
      // CAppSpotlightStore instance is unreachable from there (ADR-0024).
      // renderers/gamepad-app.tsx clones the summary's DOM shape instead,
      // rendered here (in SharedJSContext) and appended into the popup's own
      // document - the technique the reference plugin uses for playtime.
      //
      // Knowing WHICH app is showing took three tries, in order:
      // `popup.window.opener.location` (wrong - proven live to be
      // SharedJSContext's own window, whose location never navigates) ->
      // `popup.window.location` (structurally correct, but Big Picture's
      // real navigation - verified with genuine gamepad-style input, not
      // synthetic - never touches ANY window's `location`; it's an in-place
      // view swap, not routing) -> `watchGamepadAppid` (steam/gamepad-appid.ts),
      // which reads the live appid off Big Picture's own React elements as
      // they're created, verified live on two different non-Steam games.
      // See ADR-0025, ADR-0026, ADR-0027 (docs/decisions.md) for the full
      // history and evidence; only the last of the three ships.
      if (!popup.window) return;
      const window = popup.window;

      const stopWatching = watchGamepadAppid((appid) => {
        if (appid >= NON_STEAM_APPID_MIN) {
          void patchGamepadApp(window, appid);
        } else {
          unpatchGamepadApp(window);
        }
      });

      return () => {
        stopWatching();
        unpatchGamepadApp(window);
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
      void refreshGamepadApp(app.appid);
      void refreshLibraryHome();
    });
  });

  logger.info('Ready. Non-Steam games now use Steam\'s own detail sections.');
}
