/**
 * Which notification type the next preview shows: a random one, never the same twice in a row (when there is a
 * choice), so pressing Preview a few times walks through different types. Pure (tests/notifications.test.ts).
 */
export function pickPreview(names: readonly string[], last: string | null, random: () => number = Math.random): string | null {
    const pool = names.length > 1 ? names.filter((n) => n !== last) : names;
    if (!pool.length) return null;
    return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!;
}
