async function call<R>(name: string, payload: object = {}): Promise<R> {
  const millennium = (window as any)['Millennium'];
  const callFn = millennium ? millennium['callServerMethod'] : undefined;
  const candidatePlugins = ['non-steam-games-activity-dev', 'non-steam-games-activity'];
  let lastError: any;
  for (const plugin of candidatePlugins) {
    try {
      if (typeof callFn === 'function') {
        const raw = await callFn.call(millennium, plugin, name, {
          payload: JSON.stringify(payload),
        });
        return JSON.parse(raw as string) as R;
      }
    } catch (err: any) {
      lastError = err;
      if (String(err).includes('plugin not running')) {
        continue;
      }
      throw err;
    }
  }
  throw lastError;
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
