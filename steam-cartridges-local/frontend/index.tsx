
interface AppContext {
    appid: number;
    gameid: string;
    isShortcut: boolean;
    displayName: string;
}

interface AchievementUnlockItem {
    id: string;
    unlockedAt: number;
}

async function callLocalBackend<R>(name: string, payload: object = {}): Promise<R | null> {
    const millennium = (window as any)['Millennium'];
    const callFn = millennium ? millennium['callServerMethod'] : undefined;
    const candidates = ['steam-cartridges-local-dev', 'steam-cartridges-local'];
    for (const plugin of candidates) {
        try {
            if (typeof callFn === 'function') {
                const raw = await callFn.call(millennium, plugin, name, payload);
                if (typeof raw === 'string') return JSON.parse(raw) as R;
                return raw as R;
            }
        } catch {
            // try next
        }
    }
    return null;
}

const localProvider = {
    id: "steam-cartridges-local",
    name: "Local Steam Emulators (.ini / .json)",
    priority: 15,
    async match(ctx: AppContext): Promise<boolean> {
        if (!ctx.isShortcut) return false;
        const res = await callLocalBackend<{ files: any[] }>("LocalDetectFiles", { appid: ctx.appid });
        return Array.isArray(res?.files) && res.files.length > 0;
    },
    async getUnlocks(ctx: AppContext): Promise<AchievementUnlockItem[]> {
        const res = await callLocalBackend<{ unlocks: any[] }>("LocalReadUnlocks", { appid: ctx.appid });
        if (!res || !Array.isArray(res.unlocks)) return [];
        return res.unlocks.map((u: any) => ({
            id: String(u.id),
            unlockedAt: Number(u.unlockedAt) || Math.floor(Date.now() / 1000),
        }));
    },
    async reset(ctx: AppContext): Promise<{ cleared: number; ok: boolean; backupPath?: string }> {
        const res = await callLocalBackend<{ ok: boolean; cleared: number; backupPath?: string }>("LocalResetUnlocks", { appid: ctx.appid });
        return {
            ok: res?.ok ?? false,
            cleared: res?.cleared ?? 0,
            backupPath: res?.backupPath,
        };
    },
};

let registered = false;
function register() {
    if (registered) return;
    registered = true;
    const api = (window as any).SteamCartridges;
    if (api && typeof api.registerAchievementProvider === 'function') {
        api.registerAchievementProvider(localProvider);
        console.log('[steam-cartridges-local] Registered achievement provider with Steam Cartridges core.');
    } else {
        (window as any).__STEAM_CARTRIDGES_QUEUE__ = (window as any).__STEAM_CARTRIDGES_QUEUE__ || [];
        (window as any).__STEAM_CARTRIDGES_QUEUE__.push({ type: 'achievement', provider: localProvider });
        window.addEventListener('steam-cartridges:ready', ((e: CustomEvent) => {
            e.detail?.registerAchievementProvider?.(localProvider);
        }) as EventListener, { once: true });
    }
}

export default function Entry() {
    register();
}
