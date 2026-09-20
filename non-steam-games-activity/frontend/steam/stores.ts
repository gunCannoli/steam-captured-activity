import { resolveClass, resolveService, resolveSingleton } from './modules';

/**
 * Typed bindings onto Steam's own stores and services.
 *
 * These are the real objects the native app detail page uses. We do not wrap or
 * shadow them - we hand them data and let Steam render.
 *
 * Every shape here was read off the live client; see docs/steam-components.md
 * for the verbatim payloads and the probe session that produced them.
 */

// ---------------------------------------------------------------------------
// Payload shapes (exactly what Steam's own code produces and consumes)
// ---------------------------------------------------------------------------

/** One entry of `SteamClient.Apps.GetScreenshotsInTimeRange`. */
export interface SteamScreenshot {
  nAppID: number;
  strGameID: string;
  hHandle: number;
  nWidth: number;
  nHeight: number;
  nCreated: number;
  ePrivacy: number;
  strCaption: string;
  bSpoilers: boolean;
  /** Absolute `https://steamloopback.host/...` URL. Steam serves this itself. */
  strUrl: string;
  bUploaded: boolean;
  ugcHandle: string;
  publishedFileID: string;
}

/** One clip, as `CGameRecordingService.GetClips` returns it. */
export interface SteamClip {
  clip_id: string;
  game_id: string;
  duration_ms: string;
  date_recorded: number;
  start_timeline_id: string;
  start_offset_ms: string;
  file_size: string;
  date_clipped: number;
  temporary: boolean;
  thumbnail_url: string;
  thumbnail_width: number;
  thumbnail_height: number;
}

/** A session event: exactly one key is populated. */
export type SessionEvent =
  | { m_screenshot: SteamScreenshot }
  | { m_clip: SteamClip };

/** Steam's `CGamePlaySession`. */
export interface GamePlaySession {
  PushSessionEvent(event: SessionEvent): void;
  BAddScreenshotNotification(notification: {
    strOperation: 'written' | 'deleted';
    unAppID: number;
    hScreenshot: number;
    details: SteamScreenshot;
  }): boolean;
  AddClip(clip: SteamClip): void;
  RemoveClip(clipId: string): void;
  GetSessionEvents(): SessionEvent[];
  ClearSessionEvents(): SessionEvent[];
  HasSessionEvents(): boolean;
}

/** Steam's per-app spotlight state. */
export interface SpotlightAppData {
  m_unAppID: number;
  m_session: GamePlaySession;
  m_postGameSummary: GamePlaySession | null;
  m_bLoadedPreviousSessionData: boolean;
}

/** Steam's `CAppSpotlightStore` singleton. */
export interface AppSpotlightStore {
  GetOrCreateAppData(appid: number): SpotlightAppData;
  GetPostGameSummary(appid: number): GamePlaySession | null;
  EnterAppDetailsPage(appid: number): void;
  ExitAppDetailsPage(appid: number): void;
  StopShowingGamePlaySpotlight(appid: number): void;
}

/** The section registry component that decides which sections a page shows. */
export interface AppDetailsSections {
  prototype: {
    GetSections(overview: unknown, details: unknown): Set<string>;
    m_setSectionsMemo?: Set<string>;
  };
}

/** Steam's game-recording CM service. */
interface GameRecordingService {
  GetClips(request: { game_id: string; created_after: number }): Promise<{
    Body(): { clip(): Array<{ toObject(): SteamClip }> | undefined };
  }>;
}

// ---------------------------------------------------------------------------
// Resolution — by prototype signature only, never by module id
// ---------------------------------------------------------------------------

/**
 * `CAppSpotlightStore`. Identified by two methods that exist together nowhere
 * else: the summary getter and the spotlight dismissal.
 */
export function spotlightStore(): AppSpotlightStore | undefined {
  return resolveSingleton<AppSpotlightStore>('CAppSpotlightStore', [
    'GetPostGameSummary',
    'StopShowingGamePlaySpotlight',
    'GetOrCreateAppData',
  ]);
}

/**
 * The app-details sections component. `GetSections` alone is too generic, so
 * pair it with the scroll-seek and registration methods it ships beside.
 */
export function appDetailsSections(): AppDetailsSections | undefined {
  return resolveClass<AppDetailsSections>('CAppDetailsSections', [
    'GetSections',
    'SeekToSection',
    'RegisterSection',
  ]);
}

/**
 * The game-recording service that backs clips.
 *
 * `GetAndTrimPostGameHighlights` is the disambiguator: several modules expose a
 * `GetClips`, but only this service carries both.
 */
function gameRecordingService(): GameRecordingService | undefined {
  return resolveService<GameRecordingService>('CGameRecordingService', [
    'GetClips',
    'GetAndTrimPostGameHighlights',
  ]);
}

// ---------------------------------------------------------------------------
// Data sources
// ---------------------------------------------------------------------------

interface AppsApi {
  GetScreenshotsInTimeRange?: (
    appid: number,
    start: number,
    end: number,
  ) => Promise<SteamScreenshot[]>;
}

/**
 * Screenshots Steam already indexed for this app.
 *
 * Works unmodified for non-Steam games: Steam indexes a shortcut's screenshots
 * exactly like a native game's, keyed by the 32-bit appid, and hands back
 * absolute loopback URLs it serves itself. Verified live on AM2R (4 shots).
 *
 * This is why the plugin no longer needs base64 image transport for the
 * summary - Steam was always willing to serve these.
 */
export async function screenshotsSince(appid: number, since: number): Promise<SteamScreenshot[]> {
  // Cast through `unknown`: the SDK's own `Screenshot` type is narrower than
  // what ships (it omits `publishedFileID` among others), and this is
  // undocumented client surface that varies between builds regardless.
  const client = Reflect.get(globalThis, 'SteamClient') as unknown as
    | { Apps?: AppsApi }
    | undefined;
  const apps = client?.Apps;
  const fn = apps?.GetScreenshotsInTimeRange;
  if (typeof fn !== 'function') return [];

  try {
    return (await fn.call(apps, appid, since, 0)) ?? [];
  } catch {
    return [];
  }
}

/**
 * Clips Steam recorded for this game.
 *
 * Takes the **64-bit gameid**, not the appid. Steam's own helper truncates a
 * shortcut's gameid to 32 bits, which is precisely why its native path finds no
 * clips for non-Steam games - the service itself is perfectly willing to return
 * them when asked correctly. Verified live: 3 clips for AM2R.
 */
export async function clipsSince(gameid: string, since: number): Promise<SteamClip[]> {
  const service = gameRecordingService();
  if (!service) return [];

  try {
    const response = await service.GetClips({ game_id: gameid, created_after: since });
    return (response.Body().clip() ?? []).map((c) => c.toObject());
  } catch {
    return [];
  }
}
