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

/** Open a screenshot in Steam's own media viewer. */
export function openScreenshot(handle: number): boolean {
  const item = encodeURIComponent(JSON.stringify({ type: 'screenshot', id: handle }));
  return navigate(`/media?item=${item}`);
}

/**
 * Open a recording in Steam's own player.
 *
 * Steam's navigator offers both `clip` (a saved clip) and `recording` (a
 * background session, keyed by gameid). We try the clip route first and fall
 * back to the game's media grid.
 */
export function openRecording(gameid: string, clipId?: string): boolean {
  if (clipId) {
    const item = encodeURIComponent(JSON.stringify({ type: 'clip', id: clipId }));
    if (navigate(`/media?item=${item}`)) return true;
  }

  const filter = encodeURIComponent(JSON.stringify({ gameid }));
  return navigate(`/media?filter=${filter}`);
}

/** Reveal a game's screenshots in the OS file manager. */
export function showOnDisk(appid: number): void {
  screenshotsApi()?.ShowScreenshotsOnDisk?.(appid);
}
