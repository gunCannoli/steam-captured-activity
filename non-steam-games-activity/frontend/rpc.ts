import { Millennium } from '@steambrew/client';

/**
 * Typed client for the Lua backend.
 *
 * Millennium's RPC channel passes strings, so every call JSON-encodes its
 * payload and JSON-decodes the result. The backend mirrors this in
 * `backend/rpc.lua`.
 */
async function call<R>(name: string, payload: object = {}): Promise<R> {
  const raw = await Millennium.callServerMethod(name, {
    payload: JSON.stringify(payload),
  });
  return JSON.parse(raw as string) as R;
}

// ---------------------------------------------------------------------------
// Payload shapes — these mirror backend/rpc.lua. Keep them in sync.
// ---------------------------------------------------------------------------

export interface Screenshot {
  path: string;
  thumb?: string;
  taken_at: number;
  width: number;
  height: number;
}

export interface Recording {
  path: string;
  started_at: number;
  duration_ms: number;
  thumbnail?: string;
  /** DASH manifest. Not playable in a plain <video> element. */
  manifest?: string;
  width: number;
  height: number;
  kind: 'clip' | 'video';
}

export interface TimelineEntry {
  type: 'screenshot' | 'recording' | string;
  at: number;
  path: string;
  thumb?: string;
  manifest?: string;
  duration_ms?: number;
  width?: number;
  height?: number;
  kind?: string;
}

export interface TimelineDay {
  /** Local-time `YYYY-MM-DD`. */
  date: string;
  entries: TimelineEntry[];
}

export interface PostGameSummary {
  started_at: number;
  ended_at: number;
  /** `session` when scoped to a real play session, `day` when falling back. */
  source: 'session' | 'day';
  date?: string;
  entries: TimelineEntry[];
}

export interface Activity {
  appid: number;
  gameid: string;
  name?: string;
  media: { screenshots: Screenshot[]; recordings: Recording[] };
  post_game_summary?: PostGameSummary;
  timeline: TimelineDay[];
  last_session?: { id: string; started_at: number; duration_ms: number; ended_at: number };
}

export interface Diagnostics {
  ok: boolean;
  error?: string;
  steam_root?: string;
  user_id?: string;
  shortcuts?: number;
  games_with_media?: number;
  screenshots?: number;
}

export interface AssetResult {
  ok: boolean;
  /** `data:image/jpeg;base64,…` when ok. */
  uri?: string;
  bytes?: number;
  error?: string;
}

// ---------------------------------------------------------------------------

export const rpc = {
  getActivity: (appid: number) => call<Activity>('GetActivity', { appid }),

  getLibraryStats: () =>
    call<Record<string, { screenshots: number }>>('GetLibraryStats'),

  /** One image. Use for full-size images, on demand — they average ~1 MB. */
  getAsset: (path: string) => call<AssetResult>('GetAsset', { path }),

  /** Several images at once. Intended for thumbnails (~11 KB each). */
  getAssets: (paths: string[], budget?: number) =>
    call<Record<string, AssetResult>>('GetAssets', { paths, budget }),

  getDiagnostics: () => call<Diagnostics>('GetDiagnostics'),
};
