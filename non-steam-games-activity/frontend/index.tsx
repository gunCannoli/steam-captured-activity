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
      // Read the popup's own `window.location`, not its opener's. Verified
      // live (CEF devtools, 2026-09-21): `popup.window.opener` here IS
      // SharedJSContext's own window - proven with a cross-window marker
      // (`window.__x = 1` in SharedJSContext, read back as `opener.__x` from
      // inside the BPM popup) - and SharedJSContext's own `location` never
      // navigates; it stays fixed at its initial load URL for the life of
      // the process, because it is the headless parent that spawns every
      // visible window rather than one itself (matches the official "Big
      // Picture is a separate popup with its own webpack bundle" framing,
      // knowledgebase.md's "Development Quirks" summary). Watching
      // `opener.location` therefore can never see a `/library/app/<appid>`
      // path change - this was the actual cause of the empty ACTIVITY tab in
      // Big Picture, not a rendering bug in gamepad-app.tsx.
      //
      // The popup's own `window.location` is a completely ordinary
      // same-origin Location object, readable from SharedJSContext with no
      // special API (confirmed live), and it updates the normal browser way
      // whenever the popup itself navigates - the same guarantee the desktop
      // branch above leans on for its own window. No
      // MainWindowBrowserManager equivalent is needed inside Big Picture's
      // bundle; `steambrew-utils`'s `onLocationChange` is a source-agnostic
      // poller (confirmed by reading its source) - it has no opinion on
      // which Location it's given, so pointing it at the right one is on us.
      //
      // This fix alone is NOT sufficient to make the summary render under
      // normal use: live testing (real gamepad-style input, not synthetic
      // navigation) showed Big Picture's own app-details view never changes
      // ANY window's `location` at all - it is an in-place view swap, not a
      // route. See ADR-0026 (docs/decisions.md) - still Proposed, not fixed
      // here - for the confirmed-reachable alternative (an appid read off a
      // React fiber prop, anchored on a stable DOM landmark) and the
      // trade-off that needs deciding before building it.
      if (!popup.window) return;
      const window = popup.window;

      const stopWatching = onLocationChange(
        () => window.location,
        ({ pathname }) => {
          const appid = appIdFromPath(pathname);

          if (appid !== undefined && appid >= NON_STEAM_APPID_MIN) {
            void patchGamepadApp(window, appid);
          } else {
            unpatchGamepadApp(window);
          }
        },
      );

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
