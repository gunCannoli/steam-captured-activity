/**
 * Steam's own file dialog, `SteamClient.System.OpenFileDialog` (verified live 2026-10-14: Steam's "Choose icon" and "Add a
 * Non-Steam Game" call it with `{ strTitle, rgFilters: [{ strFileTypeName, rFilePatterns, bUseAsDefault }],
 * strInitialFile }` and get the chosen path back, or nothing when cancelled). Opens nothing in Steam's state; a click
 * starts it, never a render. Resolves to an absolute path, or null (cancelled, or no such API on this Steam build).
 */
const FILTERS = {
    image: { strFileTypeName: 'Images (*.png, *.jpg, *.gif, *.webp, *.svg)', rFilePatterns: ['*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.svg'] },
    sound: { strFileTypeName: 'Sounds (*.wav, *.mp3, *.ogg)', rFilePatterns: ['*.wav', '*.mp3', '*.ogg'] },
} as const;

type OpenFileDialog = (opts: { strTitle: string; rgFilters: { strFileTypeName: string; rFilePatterns: readonly string[]; bUseAsDefault?: boolean }[]; strInitialFile?: string }) => Promise<string | undefined>;

/** `win`: the window the dialog belongs to (Steam reads its own `SteamClient` from the window that asks). */
export async function pickFile(kind: keyof typeof FILTERS, title: string, win: Window = window): Promise<string | null> {
    const client = (win as unknown as { SteamClient?: { System?: { OpenFileDialog?: OpenFileDialog } } }).SteamClient ?? (Reflect.get(globalThis, 'SteamClient') as unknown as { System?: { OpenFileDialog?: OpenFileDialog } } | undefined);
    const open = client?.System?.OpenFileDialog;
    if (typeof open !== 'function') return null;
    try {
        const path = await open.call(client!.System, { strTitle: title, rgFilters: [{ ...FILTERS[kind], bUseAsDefault: true }] });
        return typeof path === 'string' && path ? path : null;
    } catch {
        return null;
    }
}

/** Whether this Steam build has the dialog (the creator shows Import only then). */
export function canPickFiles(): boolean {
    return typeof (Reflect.get(globalThis, 'SteamClient') as { System?: { OpenFileDialog?: unknown } } | undefined)?.System?.OpenFileDialog === 'function';
}
