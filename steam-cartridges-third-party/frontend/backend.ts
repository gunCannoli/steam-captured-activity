export async function callBackend<R>(name: string, payload: object = {}): Promise<R> {
  const millennium = (window as any)['Millennium'];
  const callFn = millennium ? millennium['callServerMethod'] : undefined;
  const candidates = ['steam-cartridges-third-party-dev', 'steam-cartridges-third-party'];
  let lastErr: any;
  for (const plugin of candidates) {
    try {
      if (typeof callFn === 'function') {
        const raw = await callFn.call(millennium, plugin, name, {
          payload: JSON.stringify(payload),
        });
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error(`Failed to call backend method ${name}`);
}

/** An installed Epic or Xbox game (backend store_service.installed_games). */
export interface InstalledStoreGame {
  /** Epic AppName or Xbox package family name. */
  key: string;
  title: string;
  /** The shortcut appid when the library already has one for it. */
  inLibrary?: number;
  /** How a shortcut for it is set up; absent when it cannot be (no Epic launcher found). */
  launch?: { exe: string; start_dir: string; launch_options: string };
}

/** What the push sends to steam-cartridges for one copy (backend store_service.game_data, ADR-0067). */
export interface StoreGameData {
  copy?: { kind: 'epic' | 'xbox'; title?: string } | null;
  metadata?: Record<string, unknown>;
  media?: unknown[];
  achievements?: { source: string; key: string; title?: string; achievements: unknown[]; unlocks: Record<string, number> };
  error?: string;
}

export const backend = {
  storeAccounts: () => callBackend<{ epic: { found: boolean; private: boolean }; xbox: { signed_in: boolean; gamertag?: string } }>("StoreAccounts"),
  storeInstalledGames: (allowXbox: boolean = true) =>
    callBackend<{
      epic: InstalledStoreGame[];
      xbox: InstalledStoreGame[];
      uninstalled?: { epic: Array<{ key: string; appid: number; title: string }>; xbox: Array<{ key: string; appid: number; title: string }> };
      epicLauncher?: boolean;
    }>("StoreInstalledGames", { allowXbox }),
  xboxSignInStart: () => callBackend<{ ok: boolean; user_code: string; verification_uri: string; device_code: string; interval: number; expires_in: number }>("XboxSignInStart"),
  xboxSignInPoll: (device_code: string) => callBackend<{ status: string; gamertag?: string; error?: string }>("XboxSignInPoll", { device_code }),
  xboxSignOut: () => callBackend<{ ok: boolean }>("XboxSignOut"),
  storeEpicLaunchShortcuts: () => callBackend<{ appids: number[] }>("StoreEpicLaunchShortcuts"),
  storeXboxRunning: (appid: number) => callBackend<{ xbox: boolean; running?: boolean }>("StoreXboxRunning", { appid }),
  storeXboxRepairs: () => callBackend<{ repairs: { appid: number; title?: string; exe: string; start_dir: string; launch_options?: string }[] }>("StoreXboxRepairs"),
  storeLibraryCopies: (allowEpic: boolean, allowXbox: boolean) => callBackend<{ copies: { appid: number; kind: 'epic' | 'xbox' }[] }>("StoreLibraryCopies", { allowEpic, allowXbox }),
  storeGameData: (appid: number, allowEpic: boolean, allowXbox: boolean, achievements: boolean) =>
    callBackend<StoreGameData>("StoreGameData", { appid, allowEpic, allowXbox, achievements }),
  storeEpicPrelaunch: (appid: number, heldAt: number) => callBackend<{ epic?: boolean; closed?: boolean; reason?: string }>("StoreEpicPrelaunch", { appid, heldAt }),
  storeEpicReap: (appid: number, act: "start" | "tick" | "stop") => callBackend<{ active?: boolean; phase?: string; reason?: string }>("StoreEpicReap", { appid, act }),
  storeSensorLogs: (limit: number = 60) => callBackend<{ lines: string[] }>("StoreSensorLogs", { limit }),
};
