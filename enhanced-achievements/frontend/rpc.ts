/**
 * Backend calls. Mirrors backend/main.lua; keep the payload shapes in sync.
 *
 * Bracket access and the dev/released name fallback match
 * non-steam-games-activity/frontend/rpc.ts: the build tool rewrites
 * `Millennium.callServerMethod`, which broke under the `-dev` deploy name.
 */
async function call<R>(name: string, payload: object = {}): Promise<R> {
    const millennium = (window as any)['Millennium'];
    const callFn = millennium ? millennium['callServerMethod'] : undefined;
    if (typeof callFn !== 'function') throw new Error('Millennium RPC is unavailable.');

    let lastError: unknown;
    for (const plugin of ['enhanced-achievements-dev', 'enhanced-achievements']) {
        try {
            const raw = await callFn.call(millennium, plugin, name, { payload: JSON.stringify(payload) });
            const result = JSON.parse(raw as string) as R & { error?: string };
            if (result && typeof result === 'object' && typeof result.error === 'string') throw new Error(result.error);
            return result;
        } catch (error) {
            lastError = error;
            if (String(error).includes('plugin not running')) continue;
            throw error;
        }
    }
    throw lastError;
}

export interface ThemeEntry {
    name: string;
    source: 'user' | 'bundled';
}

export interface ThemeFile {
    name: string;
    source: 'user' | 'bundled';
    dir: string;
    text: string;
}

export const rpc = {
    listThemes: () => call<{ themes: ThemeEntry[]; userDir: string }>('ListThemes'),
    loadTheme: (name: string) => call<ThemeFile>('LoadTheme', { name }),
    /** Asset path -> data URL, or false when missing / not allowed. */
    loadAssets: (dir: string, paths: string[]) => call<Record<string, string | false>>('LoadAssets', { dir, paths }),
    openThemesFolder: () => call<{ dir: string }>('OpenThemesFolder'),
};
