import { Millennium } from '@steambrew/client';

/**
 * Typed client for the Lua backend.
 *
 * Millennium's RPC channel passes strings, so every call JSON-encodes its
 * payload and JSON-decodes the result. The backend mirrors this in
 * `backend/rpc.lua`.
 *
 * ## Why this is now so small
 *
 * The backend used to supply the whole activity page: it parsed
 * `screenshots.vdf`, `clip.pb` and `gamerecording.pb`, then shipped thumbnails
 * over this channel as base64 because `steamloopback.host` refused to serve
 * our paths.
 *
 * None of that is needed for the app detail page any more. Steam already
 * indexes a non-Steam game's screenshots (`GetScreenshotsInTimeRange`) and
 * clips (the recording service), and serves both over the loopback origin
 * itself - it simply never asks for them, because of a section filter and a
 * 32-bit gameid truncation. We reuse Steam's own data, so there is no parsing
 * and no image transport. See docs/steam-components.md.
 *
 * What remains is the library grid, which needs capture timestamps for games
 * Steam has no playtime for - information Steam genuinely does not hold.
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

export interface LibraryStat {
  screenshots: number;
  /** Unix seconds of the newest capture; 0 when unknown. */
  newest: number;
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

// ---------------------------------------------------------------------------

export const rpc = {
  getLibraryStats: () => call<Record<string, LibraryStat>>('GetLibraryStats'),

  getDiagnostics: () => call<Diagnostics>('GetDiagnostics'),
};
