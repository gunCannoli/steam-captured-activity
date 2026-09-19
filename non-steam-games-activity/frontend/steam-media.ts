import { logger } from './logger';

/**
 * Steam's own media APIs and routes.
 *
 * Steam already indexes local screenshots, serves them over the loopback
 * origin, and has a media viewer that plays DASH recordings. Using those beats
 * reimplementing any of it (ADR-0019).
 *
 * Everything here is undocumented client surface, so each call is
 * feature-detected and callers fall back rather than assume.
 */

/** One entry from `SteamClient.Screenshots.GetAllLocalScreenshots()`. */
export interface LocalScreenshot {
  nAppID: number;
  strGameID: string;
  /** The id Steam's `/media` route takes for a screenshot. */
  hHandle: number;
  nWidth: number;
  nHeight: number;
  nCreated: number;
  /** `screenshots/<gameid>/screenshots/<file>.jpg`, relative to the loopback origin. */
  strUrl: string;
}

/**
 * Only the members we use. Typed loosely and read through `Reflect.get` because
 * this is undocumented client surface that varies between Steam builds - the
 * SDK's own signatures do not always match what ships.
 */
interface ScreenshotsApi {
  GetAllLocalScreenshots?: () => Promise<LocalScreenshot[]>;
  /** (appId as string, screenshot handle) - opens the OS image viewer. */
  ShowScreenshotInSystemViewer?: (appid: string, handle: number) => void;
  ShowScreenshotsOnDisk?: (appid: number) => void;
}

function screenshotsApi(): ScreenshotsApi | undefined {
  const client = Reflect.get(globalThis, 'SteamClient') as unknown as
    | Record<string, unknown>
    | undefined;
  return client?.['Screenshots'] as ScreenshotsApi | undefined;
}

function navigate(path: string): boolean {
  const store = Reflect.get(globalThis, 'SteamUIStore') as
    | { Navigate?: (url: string) => void }
    | undefined;

  if (typeof store?.Navigate !== 'function') return false;
  store.Navigate(path);
  return true;
}

/**
 * Index Steam's local screenshots by absolute-ish path, so backend entries can
 * be matched to the `hHandle` its routes need.
 *
 * Keyed on the trailing `<gameid>/screenshots/<file>` portion, which both the
 * backend path and `strUrl` contain.
 */
export async function loadScreenshotIndex(): Promise<Map<string, LocalScreenshot>> {
  const api = screenshotsApi();
  const index = new Map<string, LocalScreenshot>();

  if (typeof api?.GetAllLocalScreenshots !== 'function') {
    logger.warn('SteamClient.Screenshots unavailable; falling back to base64 assets.');
    return index;
  }

  try {
    for (const shot of await api.GetAllLocalScreenshots()) {
      const key = normaliseKey(shot.strUrl);
      if (key) index.set(key, shot);
    }
  } catch (error) {
    logger.warn('Could not read local screenshots:', error);
  }

  return index;
}

/**
 * Reduce a path or URL to `<gameid>/screenshots/<file>`, the part both Steam's
 * `strUrl` and our absolute backend paths share.
 */
export function normaliseKey(pathOrUrl: string | undefined): string | undefined {
  if (!pathOrUrl) return undefined;

  const unix = pathOrUrl.replace(/\\/g, '/');
  const match = /(\d{6,}\/screenshots\/(?:thumbnails\/)?[^/]+)$/.exec(unix);
  if (!match?.[1]) return undefined;

  // Thumbnails and full images describe the same screenshot.
  return match[1].replace('/screenshots/thumbnails/', '/screenshots/');
}

/** Loopback URL for a screenshot, full size or thumbnail. */
export function screenshotUrl(shot: LocalScreenshot, thumbnail: boolean): string {
  const url = thumbnail
    ? shot.strUrl.replace(/\/screenshots\/([^/]+)$/, '/screenshots/thumbnails/$1')
    : shot.strUrl;
  return `https://steamloopback.host/${url}`;
}

/**
 * Open a screenshot.
 *
 * Steam's in-client viewer lives at `/media/item/<type>/<id>`, but navigating
 * there directly renders a blank page: its components expect list state that
 * only Steam's own media grid supplies (its internal call passes
 * `{state: {id, filter: {listSource: {type: "app", gameid}}}}`, which is not
 * reachable through the public `Navigate(url)` surface).
 *
 * So we use `ShowScreenshotInSystemViewer`, which is a stable client API and
 * opens the image full-size in the OS viewer. Less integrated than Steam's own
 * overlay, but it reliably shows the picture instead of a black screen.
 */
export function openScreenshot(appid: number, handle: number): boolean {
  const api = screenshotsApi();
  if (typeof api?.ShowScreenshotInSystemViewer !== 'function') return false;

  try {
    api.ShowScreenshotInSystemViewer(String(appid), handle);
    return true;
  } catch (error) {
    logger.warn('Could not open the screenshot:', error);
    return false;
  }
}

/**
 * Open a recording.
 *
 * Recordings are MPEG-DASH, so there is nothing we can hand to a plain
 * `<video>`. Steam's media grid plays them, so we send the user there scoped to
 * this game rather than to a blank item page.
 */
export function openRecording(appid: number): boolean {
  // Reveal the clip on disk as the dependable fallback; the grid route does not
  // accept a game filter through Navigate().
  const api = screenshotsApi();
  if (typeof api?.ShowScreenshotsOnDisk === 'function') {
    try {
      api.ShowScreenshotsOnDisk(appid);
      return true;
    } catch {
      /* fall through */
    }
  }
  return navigate('/media/grid');
}

/** Reveal a game's screenshots in the OS file manager. */
export function showOnDisk(appid: number): void {
  screenshotsApi()?.ShowScreenshotsOnDisk?.(appid);
}
