/**
 * Steam's two ids for a non-Steam game.
 *
 *   appid  - 32-bit, in shortcuts.vdf and library URLs (/library/app/<appid>)
 *   gameid - 64-bit, for screenshot folders and recordings
 *
 *   gameid = (appid << 32) | 0x02000000
 *   appid  = gameid >> 32
 *
 * `0x02000000` is the constant low word marking a shortcut. Verified against
 * all 9 non-Steam screenshot folders on the dev machine.
 *
 * The backend does this with hand-rolled base-10^7 limb arithmetic because Lua
 * numbers are doubles. TypeScript has BigInt, so here it is just the shift.
 *
 * This conversion is the reason non-Steam clips never appear natively: Steam's
 * own helper truncates the result to 32 bits, so it asks the recording service
 * for the wrong game. Asking with the correct 64-bit value returns the clips
 * (verified live: 3 for AM2R). See docs/steam-components.md.
 */

const SHORTCUT_LOW_WORD = 0x0200_0000n;

/** Compose the 64-bit gameid for a shortcut, as a decimal string. */
export function gameIdFromAppId(appid: number): string {
  return ((BigInt(appid) << 32n) | SHORTCUT_LOW_WORD).toString();
}

