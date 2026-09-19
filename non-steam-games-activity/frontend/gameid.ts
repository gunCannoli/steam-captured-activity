/**
 * appid -> Steam's 64-bit gameid, as a decimal string.
 *
 * Mirrors backend/gameid.lua. JavaScript numbers are doubles, so the shift is
 * done with BigInt rather than `<<`, which would silently truncate to 32 bits.
 */
const SHORTCUT_LOW_WORD = 0x02000000n;

export function gameidFor(appid: number): string {
  return ((BigInt(appid) << 32n) | SHORTCUT_LOW_WORD).toString();
}
