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

export interface InstalledStoreGame {
  store: 'epic' | 'xbox';
  id: string;
  title: string;
  inLibrary: boolean;
  appid?: number;
  installPath: string;
  executable: string;
  launchUri?: string;
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
  storeXboxRepairs: () => callBackend<{ repairs: { appid: number; exe: string; start_dir: string }[] }>("StoreXboxRepairs"),
  storeEpicPrelaunch: (appid: number, heldAt: number) => callBackend<{ status: string; closed?: boolean }>("StoreEpicPrelaunch", { appid, heldAt }),
  storeEpicReap: (appid: number, act: string) => callBackend<{ status: string; done?: boolean }>("StoreEpicReap", { appid, act }),
  storeSensorLogs: (limit: number = 60) => callBackend<{ lines: string[] }>("StoreSensorLogs", { limit }),
};
