// Kernel: the one place appids are normalized (same rules as steam-cartridges' kernel/appid.ts; plugins never import
// each other, so the few functions this plugin needs are copied). Steam's CEF hands shortcut appids to JS as signed
// int32 (3858889198 arrives as -436078098), so every map here is keyed by the unsigned form from toUnsigned().
// Pure: tests load it with node.

/** Steam assigns non-Steam shortcuts appids at the top of the 32-bit range. */
export const NON_STEAM_APPID_MIN = 0x8000_0000;

/** The unsigned form of any appid Steam hands us (signed or unsigned, number or string); undefined for junk and 0. */
export function toUnsigned(raw: unknown): number | undefined {
    const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) return undefined;
    if (n < -0x8000_0000 || n > 0xffff_ffff) return undefined;
    const u = n >>> 0;
    return u === 0 ? undefined : u;
}

/** True for a non-Steam shortcut appid in either signed or unsigned form. */
export function isShortcutAppId(raw: unknown): boolean {
    const u = toUnsigned(raw);
    return u !== undefined && u >= NON_STEAM_APPID_MIN;
}

/**
 * The id Steam files an app's recordings under. A shortcut's clips use the 64-bit gameid
 * `(appid << 32) | 0x02000000`; a Steam game's use its plain appid (AGENTS.md, "The two identifiers").
 */
export function clipGameId(appid: number): string {
    if (!isShortcutAppId(appid)) return String(appid);
    return ((BigInt(appid >>> 0) << 32n) | 0x0200_0000n).toString();
}
