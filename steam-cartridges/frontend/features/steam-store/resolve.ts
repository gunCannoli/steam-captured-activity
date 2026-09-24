/**
 * Pure helpers for the Steam Store bucket. Only `import type` allowed so the
 * node test runner can load this file.
 */
import type { ArtworkUrls } from '../../rpc';

/** Native games start below this; shortcuts are at or above it. */
export const NATIVE_APPID_MAX = 0x8000_0000;

function stripBalanced(s: string, open: string, close: string): string {
    let out = '';
    let i = 0;
    while (i < s.length) {
        if (s[i] === open) {
            let depth = 0;
            let j = i;
            let found = false;
            for (; j < s.length; j++) {
                if (s[j] === open) depth++;
                else if (s[j] === close && --depth === 0) {
                    found = true;
                    break;
                }
            }
            if (found) {
                i = j + 1;
                continue;
            }
        }
        out += s[i];
        i++;
    }
    return out;
}

/**
 * Mirrors backend/steam_store_normalize.lua `normalize`; both are tested
 * against tests/fixtures/normalize-cases.json.
 */
export function normalizeTitle(input: string): string {
    let s = String(input ?? '').toLowerCase();
    s = s.replace(/[™®©]/g, '');
    s = stripBalanced(s, '(', ')');
    s = stripBalanced(s, '[', ']');
    return s.replace(/[^a-z0-9]+/g, ' ').trim();
}

export interface KnownApp {
    appid: number;
    name: string;
}

export type KnownIndex = Map<string, number[]>;

export function buildKnownIndex(apps: Iterable<KnownApp>): KnownIndex {
    const index: KnownIndex = new Map();
    for (const app of apps) {
        const key = normalizeTitle(app.name);
        if (!key) continue;
        const list = index.get(key) ?? [];
        if (!list.includes(app.appid)) list.push(app.appid);
        index.set(key, list);
    }
    return index;
}

/** Unique exact normalised match, or undefined (two natives with one name is no match). */
export function matchKnownIndex(title: string, index: KnownIndex): number | undefined {
    const list = index.get(normalizeTitle(title));
    return list && list.length === 1 ? list[0] : undefined;
}

export function matchKnownApp(title: string, apps: Iterable<KnownApp>): KnownApp | undefined {
    const list = [...apps];
    const id = matchKnownIndex(title, buildKnownIndex(list));
    return id === undefined ? undefined : list.find((a) => a.appid === id);
}

/**
 * Unhashed CDN paths; they fetch fine for existing apps (P0 T2). Newer apps
 * need hashed URLs from StoreItemCache `GetAssets()`, which the view prefers.
 */
export function cdnArtworkUrls(steamAppid: number): Required<ArtworkUrls> {
    const base = `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppid}`;
    return {
        portrait: `${base}/library_600x900.jpg`,
        hero: `${base}/library_hero.jpg`,
        logo: `${base}/logo.png`,
        wide: `${base}/header.jpg`,
    };
}
