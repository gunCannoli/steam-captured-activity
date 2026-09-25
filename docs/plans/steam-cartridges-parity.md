# steam-cartridges: native parity for mapped shortcuts (the P5 gate)

**Status:** plan, not started · 2026-09-25 · written to the
[plan writing standard](README.md#plan-writing-standard-for-the-weak-implementer).
Decisions: [ADR-0036](../decisions.md#adr-0036-default-bucket-is-steam-store-with-a-web-fallback-per-collection-title-rules)
(user decision A: no collection → Steam Store first, web scraping fallback,
per-collection include/exclude) and
[ADR-0037](../decisions.md#adr-0037-a-mapped-shortcut-borrows-its-native-apps-steam-sections-the-p5-gate-is-native-parity)
(user decision B: P5 starts only when the Jotunnslayer page holds as much data as
native app 2820820; no user-created achievements).

**Order.** [P4 hardening](steam-cartridges-p4-hardening.md) first (its § 0 says
why), then Part A (§ 4), then Parts B–E (§ 5). Every **before** block below was
cut from the tree with the previous part applied.

**Subjects.** Shortcut **2315502503** *Jotunnslayer: Hordes of Hel* (Epic copy)
and native **2820820** (same game on Steam, **not owned**). Other-game leg of
Routine 2: **435150** *Divinity: Original Sin 2* (owned). Regression subject:
**4263274102** *AM2R* (no Steam match, captures).

**What "as much data as native 2820820" means.** An unowned app has no library
page (live: `/library/app/2820820` renders an empty Big Picture page). The
reference is therefore the owned-game page template (435150) filled with the data
Steam itself holds for 2820820: `StoreItemCache` (store item), and what Steam's
own section components load for that appid (links, friends who play, community
content, news). Owner-only surfaces are out of scope for both sides (§ 1.2, N/A
rows).

## 1. Parity gap analysis (live 2026-09-24)

### 1.1 Method

Read-only CDP on `127.0.0.1:8080` ([steam-debug.md § 3](../steam-debug.md#3-the-inspection-method)):
no SharedJSContext reload, no config writes, no library changes. Steam was in
desktop mode on 2026-09-25; the Big Picture captures are from 2026-09-24 22:02.

- `StoreItemCache.QueueAppRequest(2820820, …)` then the item's own accessors
  (`GetShortDescription`, `GetDeveloperNames`, `GetReleaseDateRTime`,
  `GetStoreCategories_*`, `GetScreenshots`, `GetAllTrailers`,
  `GetFilteredReviewSummary`, `GetAllLanguagesWithSomeSupport`, `GetLinks`,
  `GetPlatforms`).
- `appDetailsStore.GetAppData(2315502503)`, `appStore.GetAppOverviewByAppID(2315502503)`,
  `PLUGIN_LIST['steam-cartridges-dev'].steamStoreState()` and `.bucketReport()`.
- `appActivityStore.GetAppActivity(2820820)` (Steam restores and fetches its own
  feed for the app; this adds Steam's own cache entry, nothing else).
- Desktop page headings and links for 2315502503 and 435150 via
  `steam://nav/games/details/<appid>`, returned to the previous page afterwards.
- Big Picture tabs (Activity, Your Stuff, Community, Game Info) for 2315502503 and 435150.
- Module sources: links component (module `52470`, export `Qd`: builds links only
  when `!overview.BIsModOrShortcut()`, from `overview.appid`), friends section
  (`2326`, `{details}` → `details.unAppID`), Community Content (`77163`, `appid`),
  desktop page renders `k.Qd({overview, details})` unconditionally (`59856`).
- The gate script of § 5 Step 28, run from a scratch copy against the current
  build: **3 PASS / 10 FAIL** (this is the ADR-0036 baseline).

State found: bucket `none` via `default` (no rule), no mapping, orphan
`applied_artwork` for 2820820 (all four slots; P4 H5), local
`library_metadata.json` entry for the **Conan DLC** (IGDB matched the wrong
product: description and `release_date` 1775692800 = Apr 8, 2026).

### 1.2 Surface by surface

"Feasible" names the part of this plan that closes the gap.

| Surface | Native 2820820 has | Shortcut 2315502503 has | Gap | Data source | Feasibility |
| --- | --- | --- | --- | --- | --- |
| **Store match** | — | none (bucket `none`, no lookup) | no Steam data at all | `storesearch` exact title (P3), `mappings` | **A** (ADR-0036 default `steam-store`) |
| Game Info: description | "Hordes of Hel is a gripping roguelike horde-survivor game…" (short description; full BBCode 4359 chars) | "Play as the legendary Conan in a major content expansion…" (DLC text from IGDB) | wrong product | `StoreItemCache` short description | **A** |
| Game Info: developers | Games Farm, ARTillery | Games Farm | missing ARTillery | `GetDeveloperNames()` (raw `m_BasicInfo.developers` has one) | **B1** |
| Game Info: publishers | Grindstone | Grindstone | none | — | PASS |
| Game Info: franchises | none | none | none | `GetFranchiseNames()` = [] | PASS |
| Game Info: release date | steam 1756917692 (Sep 3, 2025), original 1737464732 (Jan 21, 2025, Early Access) | 1775692800 / 1775692800 (Apr 8, 2026) | wrong; original date never carried | `GetReleaseDateRTime`, `GetOriginalReleaseDateRTime` | **A + B2** |
| Game Info: player categories | 2, 1, 9, 39, 24 | 2 | 1, 9, 39, 24 missing; code emits **37** (Split Screen **PvP**) for split-screen co-op | `GetStoreCategories_SupportedPlayers()` | **A + B3** |
| Game Info: controller category | 28 | 28 | none | `GetStoreCategories_Controller()` | PASS |
| Game Info: feature categories | 22 Achievements, 23 Cloud, 29 Trading Cards, 44 Remote Play Together, 62 Family Sharing | none (44 after A: existing flag) | Steam-service features of a Steam licence | `GetStoreCategories_Features()` | **not copied** (false for a non-Steam copy; user question Q1); 22 comes with P5 |
| Links (Store Page, Community Hub, Discussions, Guides, Support; DLC / Points Shop / Workshop when present) | desktop links bar and Big Picture Game Info links, all for 2820820 | desktop: none; Big Picture: links built from **2315502503** (dead store page) | wrong / missing | Steam's links component with the native appid | **C1–C2** |
| Friends who play | Steam's Friends section (renders when a friend owns/plays it) | not rendered | missing | Steam's friends section, `details.unAppID` = native | **C1–C3** |
| Community Content | Steam's Community Content rows for 2820820 | desktop header "Community Content" with no rows (loaded for the shortcut appid); Big Picture Community tab empty | empty | Steam's community section, `appid` = native | **C1–C3** |
| Activity: news / partner events | 1 partner event (type 1002, actor clan 103582791474423883, 2026-07-30) | "There's no recent activity…" (no captures) | missing | `appActivityStore` entry of 2820820 (`m_mapActivityByDay`) | **D** |
| Activity: friends' achievements / reviews | none for this app | none | none | — | N/A |
| Artwork: hero, portrait, wide | store assets | custom `2315502503_hero.jpg`, `p.jpg`, `.jpg` (CDN art from an old P3 run) | recorded without a mapping (orphan) | `GetAssets()` + CDN, `SetCustomArtworkForApp` | **P4 H5 + A** (adopted once mapped) |
| Artwork: logo | `logo.png` drawn in the header | `2315502503_logo.png` exists; Big Picture header draws no logo (no logo position: `TopCapsule` draws only when `logoPosition !== null`) | not drawn | `appDetailsStore.SaveCustomLogoPosition` (Steam's "Adjust logo position") | **E** |
| Your Stuff: Media | captures (owner) | Steam's own placeholder (no captures of this game) | none | captures | PASS |
| Notes | yes | yes | none | — | PASS |
| Post-Game Summary | owner play sessions | from captures (none here) | none | captures | N/A (capture-driven for every shortcut) |
| Achievements | schema known to Steam; unowned → locked list | none | — | ADR-0034 | **P5** (behind this gate) |
| Trading cards, DLC ownership, Workshop subscriptions, My Review, playtime, cloud, controller config | owner-only | none | none (an unowned native page has none) | — | N/A |
| Store-page data: screenshots (33), trailers (7), tags (20), languages (12), requirements, reviews (Very Positive, 82 % of 7330), metacritic, Deck compatibility (3) | store page only; the library page does not show them | reachable through the Store Page link once C lands | none on the library page | — | N/A (ADR-0022: do not rebuild the store page) |
| Big Picture tabs | Activity, Your Stuff, Community, Game Info | same four | none | — | PASS |

### 1.3 Root causes

- **A.** No collection rule claims the shortcut, and the old default `none`
  means no lookup (ADR-0032/0033), so Steam's data is never read; the local IGDB
  entry (wrong product) is all Game Info has.
- **B.** `metadataFromStoreItem` reads the raw `m_BasicInfo.developers` (one
  entry) instead of Steam's `GetDeveloperNames()`, keeps only
  `steam_release_date`, and `STEAM_CATEGORIES.SPLIT_SCREEN_COOP` is 37 (Steam:
  37 = Shared/Split Screen PvP, 39 = Shared/Split Screen Co-op).
- **C.** Steam's Links, Friends and Community components key on the page's
  appid (`overview.appid`, `details.unAppID`, `appid`), which is the shortcut's.
  For the links, `BIsModOrShortcut()` also decides whether any are built.
- **D.** The shortcut's feed holds only our capture events; Steam has the native
  app's events in its own store but nothing joins them.
- **E.** A custom logo without a logo position is never drawn by Big Picture's
  header; Steam writes the position only when the user uses "Adjust logo position".

**Ruled out:** a StoreItemCache load failure (`BIsAppMissing(2820820)` is
false and every field loads); a rendering bug in our Game Info patch (the
fields shown are exactly the local entry's); stale DOM across navigation
(headings re-read per page show only that page's sections).

## 2. research/game-data-linker: adopt / adapt / drop

| Linker feature | Decision | Where |
| --- | --- | --- |
| `fetch_game_data` (store `appdetails`) | **adopt** (done) | P3 `SteamStoreGetAppDetails`, fallback after `StoreItemCache` |
| `steam_search_appid` (storesearch) | **adopt** (done), exact unique title only | P3 `SteamStoreSearch`; P4 H2/H3 limits |
| `save_mapping` / `remove_mapping` / `get_all_mappings` | **adopt** (done) | P3 `steam_store.json` mappings, Clear with reject |
| `save_artwork` / `clear_artwork` (writes into `grid/`) | **adapt** to `SetCustomArtworkForApp` with a per-slot record | P3; P4 H5; E (logo position) |
| `fetch_news` (`ISteamNews/GetNewsForApp`) | **adapt** to Steam's own activity feed for the native appid; no Web API call | D |
| `fetch_partner_events` / `scrape_partner_events` (news-hub HTML scrape) | **adapt** to Steam's own partner-event objects; the scraper is dropped | D |
| `cross_platform_patch_notes` | **drop** (Epic/Xbox path; D covers mapped games) | — |
| `fetch_community_content` (community home scrape) | **adapt** to Steam's Community Content section with the native appid | C |
| `fetch_published_file_previews` | **drop** (Steam's section loads its own previews) | — |
| `fetch_friend_personas` / friends-who-play | **adapt** to Steam's Friends section with the native appid | C |
| `fetch_friend_review` | **drop** (owner/store-page data) | — |
| Linker activity feed UI | **adapt** to Steam's own feed (core since ADR-0030) plus D | D |
| SteamGridDB logo/art (`sgdb_*`) | later, optional | P6 |
| Epic / Xbox auth, game data, friends, news, community, artwork; status posting | **drop** (already) | — |

## 3. Preconditions (run first; stop if any differs)

All commands use Git Bash. P4 must be committed.

```bash
cd /c/game/millennium && git status --porcelain -- steam-cartridges scratch/check_parity.mjs
```
Expected: no output.

```bash
cd /c/game/millennium && git log -1 --format=%s -- steam-cartridges
```
Expected: `fix(steam-cartridges): P4 hardening - metadata shape guard, wall-clock throttle, offline breaker, per-slot art record, view replay`.

```bash
cd /c/game/millennium/steam-cartridges && npm run check && npm run test:ts 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Expected: the two `check` banner lines, nothing from `tsc`, then exactly:
```
ℹ tests 28
ℹ pass 28
ℹ fail 0
```

Every **before** block is copied from the file. If `Edit` cannot find it
exactly, the plan is stale: stop (failure rule, § 8). After each step, the
**Check** line's `git hash-object` must print exactly the hash shown (line
endings do not matter). `npm run check` may fail in the middle of a part (a
signature changes before its callers); run it only at the gate steps.

## 4. Part A: ADR-0036 policy change

What it does: config v2 (`rules` with `include` / `exclude` title patterns,
`version: 2`, fixed `default: 'steam-store'`, v1 `assignments` migrated in
memory); resolutions memoised per session and dropped on any bucket-settings
change; `handleSteamStoreView` resolves to `true` (store data applied),
`false` (no Steam match or its data failed: web-scraping fallback) or
`undefined` (title not known yet: local Game Info only); the settings panel
edits rules and patterns, lists only games with a match, suggestions or art,
and has one "match by hand" row.

### Step 1: `steam-cartridges/frontend/features/buckets/resolve.ts` — config v2, default steam-store, title patterns

**Edit 1 of 3.** Before:

```ts
/**
 * Pure bucket resolution (ADR-0033). No runtime imports, so Node can run the
 * unit tests with type stripping.
 */
export type Bucket = 'steam-store' | 'web-scraping' | 'none';

export interface BucketAssignment {
    id: string;
    name: string;
    bucket: Exclude<Bucket, 'none'>;
}

export interface BucketsConfig {
    version: 1;
    default: 'none';
    /** ORDER = precedence; a collection id appears once. */
    assignments: BucketAssignment[];
    /** Shortcut appid (string) -> bucket. Shortcuts only: no native data is persisted. */
    overrides: Record<string, Bucket>;
}
```

After:

```ts
/**
 * Pure bucket resolution (ADR-0033, amended by ADR-0036). No runtime imports,
 * so Node can run the unit tests with type stripping.
 *
 * ADR-0036: a shortcut that no rule claims gets the fixed default bucket
 * `steam-store`. A steam-store game with no Steam match falls back to web
 * scraping at view time (features/source-view.ts), not here. Each collection
 * rule may narrow itself with title patterns (include / exclude).
 */
export type Bucket = 'steam-store' | 'web-scraping' | 'none';

export interface CollectionRule {
    /** Steam collection id. */
    id: string;
    /** Display name when the rule was saved; used to re-find a re-created collection. */
    name: string;
    /** The collection's bucket. 'none' = never fetch for its games (local Game Info only). */
    bucket: Bucket;
    /** Title patterns. Empty = every game in the collection. */
    include: string[];
    /** Title patterns. A matching game skips this rule (and falls through to later rules / default). */
    exclude: string[];
}

export interface BucketsConfig {
    version: 2;
    /** Fixed (ADR-0036); validation forces it. */
    default: 'steam-store';
    /** ORDER = precedence; a collection id appears once. */
    rules: CollectionRule[];
    /** Shortcut appid (string) -> bucket. Shortcuts only: no native data is persisted. */
    overrides: Record<string, Bucket>;
}
```

**Edit 2 of 3.** Before:

```ts
}

export type MembersOf = (collectionId: string) => ReadonlySet<number> | undefined;

export const SHORTCUT_MIN = 0x8000_0000;

export const DEFAULT_BUCKETS: BucketsConfig = { version: 1, default: 'none', assignments: [], overrides: {} };

const isBucket = (v: unknown): v is Bucket => v === 'steam-store' || v === 'web-scraping' || v === 'none';

/** Never throws. Drops malformed entries; forces `default: 'none'`. */
export function validateConfig(raw: unknown): BucketsConfig {
    const out: BucketsConfig = { version: 1, default: 'none', assignments: [], overrides: {} };
    if (!raw || typeof raw !== 'object') return out;
    const r = raw as Record<string, unknown>;

    if (Array.isArray(r.assignments)) {
        const seen = new Set<string>();
        for (const a of r.assignments) {
            if (!a || typeof a !== 'object') continue;
            const { id, name, bucket } = a as Record<string, unknown>;
            if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
            if (bucket !== 'steam-store' && bucket !== 'web-scraping') continue;
            seen.add(id);
            out.assignments.push({ id, name: typeof name === 'string' ? name : id, bucket });
        }
    }

    if (r.overrides && typeof r.overrides === 'object' && !Array.isArray(r.overrides)) {
```

After:

```ts
}

export type MembersOf = (collectionId: string) => ReadonlySet<number> | undefined;
export type TitleOf = (appid: number) => string | undefined;

export const SHORTCUT_MIN = 0x8000_0000;
export const MAX_PATTERNS = 32;
export const MAX_PATTERN_LENGTH = 100;

export const DEFAULT_BUCKETS: BucketsConfig = { version: 2, default: 'steam-store', rules: [], overrides: {} };

const isBucket = (v: unknown): v is Bucket => v === 'steam-store' || v === 'web-scraping' || v === 'none';

function patterns(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const p of v) {
        if (typeof p !== 'string') continue;
        const t = p.trim();
        if (t && t.length <= MAX_PATTERN_LENGTH && !out.includes(t)) out.push(t);
        if (out.length >= MAX_PATTERNS) break;
    }
    return out;
}

/** "a, b ,,c" -> ["a", "b", "c"] (the settings panel's text field). */
export function splitPatterns(text: string): string[] {
    return patterns(String(text ?? '').split(','));
}

/**
 * Case-insensitive title match, never a regex built from user text.
 * No wildcard: substring match. With `*` (any run) or `?` (one character): the
 * whole title must match.
 */
export function matchesPattern(title: string, pattern: string): boolean {
    const t = String(title ?? '').toLowerCase();
    const p = String(pattern ?? '').toLowerCase();
    if (!p) return false;
    if (!p.includes('*') && !p.includes('?')) return t.includes(p);
    let ti = 0;
    let pi = 0;
    let star = -1;
    let mark = 0;
    while (ti < t.length) {
        if (pi < p.length && (p[pi] === '?' || p[pi] === t[ti])) {
            ti++;
            pi++;
        } else if (pi < p.length && p[pi] === '*') {
            star = pi++;
            mark = ti;
        } else if (star >= 0) {
            pi = star + 1;
            ti = ++mark;
        } else {
            return false;
        }
    }
    while (pi < p.length && p[pi] === '*') pi++;
    return pi === p.length;
}

/** Does this rule claim a game with this title? */
export function ruleAppliesTo(rule: CollectionRule, title: string | undefined): boolean {
    const name = title ?? '';
    if (rule.include.length > 0 && !rule.include.some((p) => matchesPattern(name, p))) return false;
    return !rule.exclude.some((p) => matchesPattern(name, p));
}

/** Never throws. Migrates v1 `assignments`; drops malformed entries; forces `default: 'steam-store'`. */
export function validateConfig(raw: unknown): BucketsConfig {
    const out: BucketsConfig = { version: 2, default: 'steam-store', rules: [], overrides: {} };
    if (!raw || typeof raw !== 'object') return out;
    const r = raw as Record<string, unknown>;

    // v1 stored `assignments` (no patterns); v2 stores `rules` (ADR-0036).
    const list = Array.isArray(r.rules) ? r.rules : Array.isArray(r.assignments) ? r.assignments : [];
    const seen = new Set<string>();
    for (const a of list) {
        if (!a || typeof a !== 'object') continue;
        const { id, name, bucket, include, exclude } = a as Record<string, unknown>;
        if (typeof id !== 'string' || id === '' || seen.has(id) || !isBucket(bucket)) continue;
        seen.add(id);
        out.rules.push({
            id,
            name: typeof name === 'string' ? name : id,
            bucket,
            include: patterns(include),
            exclude: patterns(exclude),
        });
    }

    if (r.overrides && typeof r.overrides === 'object' && !Array.isArray(r.overrides)) {
```

**Edit 3 of 3.** Before:

```ts
    return out;
}

export function resolveBucket(appid: number, cfg: BucketsConfig, membersOf: MembersOf): Resolution {
    if (!(appid >= SHORTCUT_MIN)) return { bucket: 'none', via: 'not-a-shortcut' };

    const override = cfg.overrides[String(appid)];
    if (override) return { bucket: override, via: 'override' };

    let winner: BucketAssignment | undefined;
    const ids: string[] = [];
    const buckets: Bucket[] = [];
    for (const a of cfg.assignments) {
        if (!membersOf(a.id)?.has(appid)) continue;
        winner ??= a;
        ids.push(a.id);
        buckets.push(a.bucket);
    }
    if (!winner) return { bucket: 'none', via: 'default' };

    const res: Resolution = { bucket: winner.bucket, via: 'collection', collectionId: winner.id };
    if (new Set(buckets).size > 1) res.conflict = { collectionIds: ids, buckets };
    return res;
}

/** Appids (from `appids`) that sit in assigned collections of different buckets. */
export function findConflicts(
    cfg: BucketsConfig,
    membersOf: MembersOf,
    appids: Iterable<number>,
): { appid: number; resolution: Resolution }[] {
    const out: { appid: number; resolution: Resolution }[] = [];
    for (const appid of appids) {
        const resolution = resolveBucket(appid, cfg, membersOf);
        if (resolution.conflict && resolution.via === 'collection') out.push({ appid, resolution });
    }
    return out;
```

After:

```ts
    return out;
}

export function resolveBucket(
    appid: number,
    cfg: BucketsConfig,
    membersOf: MembersOf,
    titleOf: TitleOf = () => undefined,
): Resolution {
    if (!(appid >= SHORTCUT_MIN)) return { bucket: 'none', via: 'not-a-shortcut' };

    const override = cfg.overrides[String(appid)];
    if (override) return { bucket: override, via: 'override' };

    let winner: CollectionRule | undefined;
    const ids: string[] = [];
    const buckets: Bucket[] = [];
    let title: string | undefined;
    let titleRead = false;
    for (const rule of cfg.rules) {
        if (!membersOf(rule.id)?.has(appid)) continue;
        if (rule.include.length > 0 || rule.exclude.length > 0) {
            if (!titleRead) {
                title = titleOf(appid);
                titleRead = true;
            }
            if (!ruleAppliesTo(rule, title)) continue;
        }
        winner ??= rule;
        ids.push(rule.id);
        buckets.push(rule.bucket);
    }
    if (!winner) return { bucket: cfg.default, via: 'default' };

    const res: Resolution = { bucket: winner.bucket, via: 'collection', collectionId: winner.id };
    if (new Set(buckets).size > 1) res.conflict = { collectionIds: ids, buckets };
    return res;
}

/** Appids (from `appids`) claimed by rules of different buckets. */
export function findConflicts(
    cfg: BucketsConfig,
    membersOf: MembersOf,
    appids: Iterable<number>,
    titleOf: TitleOf = () => undefined,
): { appid: number; resolution: Resolution }[] {
    const out: { appid: number; resolution: Resolution }[] = [];
    for (const appid of appids) {
        const resolution = resolveBucket(appid, cfg, membersOf, titleOf);
        if (resolution.conflict && resolution.via === 'collection') out.push({ appid, resolution });
    }
    return out;
```

Check: `git hash-object steam-cartridges/frontend/features/buckets/resolve.ts` prints `41622ca5aa0f8cb40a4809fd3cd3b03b4aeed624`.

### Step 2: `steam-cartridges/tests/buckets.test.ts` — unit tests for the v2 model

First run `git hash-object steam-cartridges/tests/buckets.test.ts`; it must print `f8d516def35d6a5d18d8554ab2d92a9d3472d0aa` (otherwise the plan is stale: stop). Then replace the whole file with exactly:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_BUCKETS,
    findConflicts,
    matchesPattern,
    resolveBucket,
    splitPatterns,
    validateConfig,
} from '../frontend/features/buckets/resolve.ts';
import type { BucketsConfig, CollectionRule } from '../frontend/features/buckets/resolve.ts';

const A = 0x8000_0001, B = 0x8000_0002, C = 0x8000_0003, D = 0x8000_0004, N = 435150;
const sets: Record<string, Set<number>> = { steam: new Set([A, C, N]), retro: new Set([B, C]) };
const membersOf = (id: string) => sets[id];
const titles: Record<number, string> = { [A]: 'Alan Wake 2', [B]: 'Super Metroid (USA)', [C]: 'Castlevania', [D]: 'AM2R' };
const titleOf = (appid: number) => titles[appid];
const rule = (id: string, bucket: CollectionRule['bucket'], over: Partial<CollectionRule> = {}): CollectionRule => ({
    id,
    name: id,
    bucket,
    include: [],
    exclude: [],
    ...over,
});
const cfg = (over: Partial<BucketsConfig> = {}): BucketsConfig => ({
    ...DEFAULT_BUCKETS,
    rules: [rule('steam', 'steam-store'), rule('retro', 'web-scraping')],
    ...over,
});

test('basic resolution; no rule -> steam-store default (ADR-0036)', () => {
    assert.deepEqual(resolveBucket(A, cfg(), membersOf, titleOf), { bucket: 'steam-store', via: 'collection', collectionId: 'steam' });
    assert.equal(resolveBucket(B, cfg(), membersOf, titleOf).bucket, 'web-scraping');
    assert.deepEqual(resolveBucket(D, cfg(), membersOf, titleOf), { bucket: 'steam-store', via: 'default' });
    assert.deepEqual(resolveBucket(D, DEFAULT_BUCKETS, membersOf, titleOf), { bucket: 'steam-store', via: 'default' });
    assert.deepEqual(resolveBucket(N, cfg(), membersOf, titleOf), { bucket: 'none', via: 'not-a-shortcut' });
});

test('conflict follows list order', () => {
    const r = resolveBucket(C, cfg(), membersOf, titleOf);
    assert.equal(r.bucket, 'steam-store');
    assert.deepEqual(r.conflict, { collectionIds: ['steam', 'retro'], buckets: ['steam-store', 'web-scraping'] });
    const swapped = cfg({ rules: [...cfg().rules].reverse() });
    assert.equal(resolveBucket(C, swapped, membersOf, titleOf).bucket, 'web-scraping');
    assert.deepEqual(findConflicts(cfg(), membersOf, [A, B, C, D], titleOf).map((c) => c.appid), [C]);
});

test('overrides beat rules and the default', () => {
    const c = cfg({ overrides: { [C]: 'none', [A]: 'web-scraping', [D]: 'none' } });
    assert.deepEqual(resolveBucket(C, c, membersOf, titleOf), { bucket: 'none', via: 'override' });
    assert.equal(resolveBucket(A, c, membersOf, titleOf).bucket, 'web-scraping');
    assert.equal(resolveBucket(D, c, membersOf, titleOf).bucket, 'none');
});

test('a none rule stops fetching for its collection', () => {
    const c = cfg({ rules: [rule('retro', 'none')] });
    assert.deepEqual(resolveBucket(B, c, membersOf, titleOf), { bucket: 'none', via: 'collection', collectionId: 'retro' });
});

test('deleted collection is skipped -> default', () => {
    const m = (id: string) => (id === 'retro' ? undefined : sets[id]);
    assert.deepEqual(resolveBucket(B, cfg(), m, titleOf), { bucket: 'steam-store', via: 'default' });
});

test('exclude patterns make a game fall through to later rules / default', () => {
    const c = cfg({ rules: [rule('steam', 'steam-store', { exclude: ['castle'] }), rule('retro', 'web-scraping')] });
    const r = resolveBucket(C, c, membersOf, titleOf);
    assert.equal(r.bucket, 'web-scraping');
    assert.equal(r.conflict, undefined, 'an excluded rule is not a conflict');
    const onlyExcluded = cfg({ rules: [rule('steam', 'web-scraping', { exclude: ['alan*'] })] });
    assert.deepEqual(resolveBucket(A, onlyExcluded, membersOf, titleOf), { bucket: 'steam-store', via: 'default' });
});

test('include patterns restrict a rule to matching titles', () => {
    const c = cfg({ rules: [rule('retro', 'web-scraping', { include: ['(usa)'] })] });
    assert.equal(resolveBucket(B, c, membersOf, titleOf).bucket, 'web-scraping');
    assert.deepEqual(resolveBucket(C, c, membersOf, titleOf), { bucket: 'steam-store', via: 'default' });
    const unknownTitle = resolveBucket(C, c, membersOf, () => undefined);
    assert.equal(unknownTitle.via, 'default', 'an include rule never claims a game whose title is unknown');
});

test('matchesPattern: substring without wildcards, whole-title glob with them', () => {
    assert.ok(matchesPattern('Super Metroid (USA)', 'metroid'));
    assert.ok(matchesPattern('Super Metroid (USA)', '*(usa)'));
    assert.ok(!matchesPattern('Super Metroid (USA)', 'metroid*'), 'a glob is anchored to the whole title');
    assert.ok(matchesPattern('Doom 2', 'doom ?'));
    assert.ok(!matchesPattern('Doom 64', 'doom ?'));
    assert.ok(matchesPattern('anything', '*'));
    assert.ok(!matchesPattern('anything', ''));
    assert.ok(matchesPattern('a+b(c)[d]', 'a+b(c)[d]'), 'regex characters are literal');
});

test('splitPatterns trims, dedupes and caps', () => {
    assert.deepEqual(splitPatterns(' a, b ,,a, c '), ['a', 'b', 'c']);
    assert.equal(splitPatterns(Array.from({ length: 40 }, (_, i) => `p${i}`).join(',')).length, 32);
    assert.deepEqual(splitPatterns('x'.repeat(101)), []);
});

test('validateConfig: v1 migration, forced default, junk dropped', () => {
    const v1 = validateConfig({
        default: 'none',
        assignments: [
            { id: 'x', name: 'X', bucket: 'steam-store' },
            { id: 'x', name: 'X2', bucket: 'web-scraping' },
            { id: 'y', name: 'Y', bucket: 'bogus' },
            null,
        ],
        overrides: { [A]: 'web-scraping', abc: 'none', '435150': 'steam-store', [B]: 'nope' },
    });
    assert.equal(v1.version, 2);
    assert.equal(v1.default, 'steam-store');
    assert.deepEqual(v1.rules, [{ id: 'x', name: 'X', bucket: 'steam-store', include: [], exclude: [] }]);
    assert.deepEqual(v1.overrides, { [A]: 'web-scraping' });
    const v2 = validateConfig({ rules: [{ id: 'r', bucket: 'none', include: ['a', 5, ' '], exclude: 'x' }] });
    assert.deepEqual(v2.rules, [{ id: 'r', name: 'r', bucket: 'none', include: ['a'], exclude: [] }]);
    for (const g of [null, 5, 'x', [], undefined]) assert.deepEqual(validateConfig(g), DEFAULT_BUCKETS);
});

test('exclusivity property', () => {
    const ids = ['a', 'b', 'c'];
    const bs = ['steam-store', 'web-scraping', 'none', 'x'];
    const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
    for (let i = 0; i < 300; i++) {
        const rules = Array.from({ length: Math.floor(Math.random() * 8) }, () => ({ id: pick(ids), name: 'n', bucket: pick(bs) }));
        const seen = validateConfig({ rules }).rules.map((a) => a.id);
        assert.equal(new Set(seen).size, seen.length);
    }
});
```

Check: `git hash-object steam-cartridges/tests/buckets.test.ts` prints `e6aa239d130ead1adbfbf802010303c4bbffee07`.

### Step 3: `steam-cartridges/frontend/features/buckets/index.ts` — sticky per-session resolutions, titles for patterns

**Edit 1 of 4.** Before:

```ts
import { findConflicts, resolveBucket, SHORTCUT_MIN, type Bucket, type Resolution } from './resolve';

export { waitForCollections, listCollections, invalidateMembership, collectionsReady } from './collections';
export type { Bucket, BucketsConfig, Resolution } from './resolve';

let metadataAppids: () => Iterable<number> = () => [];
/** game-info registers its cache here (avoids an import cycle). */
```

After:

```ts
import { findConflicts, resolveBucket, SHORTCUT_MIN, type Bucket, type Resolution } from './resolve';

export { waitForCollections, listCollections, invalidateMembership, collectionsReady } from './collections';
export type { Bucket, BucketsConfig, CollectionRule, Resolution } from './resolve';

let metadataAppids: () => Iterable<number> = () => [];
/** game-info registers its cache here (avoids an import cycle). */
```

**Edit 2 of 4.** Before:

```ts
    metadataAppids = fn;
}

/** Current settings + live collections. */
export function getBucket(appid: number): Resolution {
    const cfg = setting('buckets');
    if (appid >= SHORTCUT_MIN && cfg.overrides[String(appid)]) return resolveBucket(appid, cfg, membersOf);
    return pendingOr<Resolution>(cfg.assignments.length > 0, collectionsReady(), () => resolveBucket(appid, cfg, membersOf)) as Resolution;
}

export function onBucketsChanged(fn: () => void): () => void {
    return onSettingChange((key) => {
        if (key === 'buckets') fn();
    });
}
```

After:

```ts
    metadataAppids = fn;
}

/** The shortcut's display title (O(1) appStore lookup), for rule patterns. */
function titleOf(appid: number): string | undefined {
    try {
        const name = (window as any).appStore?.GetAppOverviewByAppID?.(appid)?.display_name;
        return typeof name === 'string' ? name : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Resolutions are sticky for the session (ADR-0036) and dropped only when the
 * bucket settings change. Our own Game Info enrichment adds store categories,
 * which feed Steam's dynamic collections; without this a game could leave a
 * rule's collection because we enriched it, and flip bucket on the next view.
 * `pending` is never memoised.
 */
const memo = new Map<number, Resolution>();

/** Current settings + live collections, memoised per session. */
export function getBucket(appid: number): Resolution {
    const hit = memo.get(appid);
    if (hit) return hit;
    const cfg = setting('buckets');
    const r =
        appid >= SHORTCUT_MIN && cfg.overrides[String(appid)]
            ? resolveBucket(appid, cfg, membersOf, titleOf)
            : (pendingOr<Resolution>(cfg.rules.length > 0, collectionsReady(), () =>
                  resolveBucket(appid, cfg, membersOf, titleOf),
              ) as Resolution);
    if (r.via !== 'pending') memo.set(appid, r);
    return r;
}

export function onBucketsChanged(fn: () => void): () => void {
    return onSettingChange((key) => {
        if (key !== 'buckets') return;
        memo.clear();
        fn();
    });
}
```

**Edit 3 of 4.** Before:

```ts
    const ready = collectionsReady();
    const live = listCollections();
    const liveIds = new Set(live.map((c) => c.id));
    const assigned = new Map(cfg.assignments.map((a) => [a.id, a.bucket] as const));
    const shortcuts = listShortcuts();
    const appids = shortcuts.map((s) => s.appid);
```

After:

```ts
    const ready = collectionsReady();
    const live = listCollections();
    const liveIds = new Set(live.map((c) => c.id));
    const assigned = new Map(cfg.rules.map((a) => [a.id, a.bucket] as const));
    const shortcuts = listShortcuts();
    const appids = shortcuts.map((s) => s.appid);
```

**Edit 4 of 4.** Before:

```ts
    }
    return {
        ready,
        collections: live.map((c) => ({ ...c, bucket: assigned.get(c.id) ?? 'none' })),
        conflicts: findConflicts(cfg, membersOf, appids).map(({ appid, resolution }) => ({
            appid,
            name: shortcutName(appid),
            collectionIds: resolution.conflict!.collectionIds,
            buckets: resolution.conflict!.buckets,
            using: resolution.bucket,
        })),
        missing: cfg.assignments
            .filter((a) => !liveIds.has(a.id))
            .map((a) => ({ id: a.id, name: a.name, bucket: a.bucket, relinkId: live.find((c) => c.name === a.name)?.id })),
        unbucketedWithMetadata: [...metadataAppids()].filter((id) => getBucket(id).bucket === 'none').length,
```

After:

```ts
    }
    return {
        ready,
        collections: live.map((c) => ({ ...c, bucket: assigned.get(c.id) ?? cfg.default })),
        conflicts: findConflicts(cfg, membersOf, appids, titleOf).map(({ appid, resolution }) => ({
            appid,
            name: shortcutName(appid),
            collectionIds: resolution.conflict!.collectionIds,
            buckets: resolution.conflict!.buckets,
            using: resolution.bucket,
        })),
        missing: cfg.rules
            .filter((a) => !liveIds.has(a.id))
            .map((a) => ({ id: a.id, name: a.name, bucket: a.bucket, relinkId: live.find((c) => c.name === a.name)?.id })),
        unbucketedWithMetadata: [...metadataAppids()].filter((id) => getBucket(id).bucket === 'none').length,
```

Check: `git hash-object steam-cartridges/frontend/features/buckets/index.ts` prints `0e9aa0a6fe57d3a4ac28688f4c7c9b61879b7970`.

### Step 4: `steam-cartridges/frontend/features/game-info/policy.ts` — steam-store local tier and web fallback

**Edit 1 of 1.** Before:

```ts
/**
 * Game Info tiers per bucket (ADR-0035). Pure, no imports, so Node can run the
 * unit tests with type stripping.
 *
 *   local tier : library_metadata.json on disk. Applied to every shortcut that
 *                is not steam-store (none and pending included). No network.
 *   fetch tier : GetGameMetadata (IGDB). web-scraping only (ADR-0032).
 *   steam-store: owned by features/steam-store; neither tier runs.
 */
export interface GameInfoPlan {
    applyLocal: boolean;
    fetchWeb: boolean;
}

export function gameInfoPlan(bucket: string, via: string): GameInfoPlan {
    if (bucket === "steam-store") return { applyLocal: false, fetchWeb: false };
    if (via === "pending") return { applyLocal: true, fetchWeb: false };
    return { applyLocal: true, fetchWeb: bucket === "web-scraping" };
}
```

After:

```ts
/**
 * Game Info tiers per bucket (ADR-0035, amended by ADR-0036). Pure, no
 * imports, so Node can run the unit tests with type stripping.
 *
 *   local tier : library_metadata.json on disk. No network.
 *   fetch tier : GetGameMetadata (IGDB). web-scraping, and the steam-store
 *                fallback when the game has no Steam match (ADR-0036).
 *   steam-store: with a Steam match, features/steam-store owns Game Info and
 *                neither tier runs. Before the store has answered, local only.
 *
 * `storeMatched`: true = store data applied, false = no Steam match,
 * undefined = not known yet (or not a steam-store game).
 */
export interface GameInfoPlan {
    applyLocal: boolean;
    fetchWeb: boolean;
}

export function gameInfoPlan(bucket: string, via: string, storeMatched?: boolean): GameInfoPlan {
    if (via === "pending") return { applyLocal: true, fetchWeb: false };
    if (bucket === "steam-store") {
        if (storeMatched === true) return { applyLocal: false, fetchWeb: false };
        return { applyLocal: true, fetchWeb: storeMatched === false };
    }
    return { applyLocal: true, fetchWeb: bucket === "web-scraping" };
}
```

Check: `git hash-object steam-cartridges/frontend/features/game-info/policy.ts` prints `7cd86e33c409cdf25d8fe12e8070f459a1770793`.

### Step 5: `steam-cartridges/tests/game-info-policy.test.ts` — policy tests

**Edit 1 of 2.** Before:

```ts

test('none: local Game Info, no fetch (ADR-0035)', () => {
    assert.deepEqual(gameInfoPlan('none', 'default'), { applyLocal: true, fetchWeb: false });
});

test('pending: local Game Info, no fetch', () => {
```

After:

```ts

test('none: local Game Info, no fetch (ADR-0035)', () => {
    assert.deepEqual(gameInfoPlan('none', 'default'), { applyLocal: true, fetchWeb: false });
    assert.deepEqual(gameInfoPlan('none', 'collection'), { applyLocal: true, fetchWeb: false });
});

test('pending: local Game Info, no fetch', () => {
```

**Edit 2 of 2.** Before:

```ts
    assert.deepEqual(gameInfoPlan('web-scraping', 'override'), { applyLocal: true, fetchWeb: true });
});

test('steam-store: neither tier (the store handler owns Game Info)', () => {
    assert.deepEqual(gameInfoPlan('steam-store', 'collection'), { applyLocal: false, fetchWeb: false });
    assert.deepEqual(gameInfoPlan('steam-store', 'override'), { applyLocal: false, fetchWeb: false });
});
```

After:

```ts
    assert.deepEqual(gameInfoPlan('web-scraping', 'override'), { applyLocal: true, fetchWeb: true });
});

test('steam-store with a match: neither tier (the store handler owns Game Info)', () => {
    assert.deepEqual(gameInfoPlan('steam-store', 'default', true), { applyLocal: false, fetchWeb: false });
    assert.deepEqual(gameInfoPlan('steam-store', 'override', true), { applyLocal: false, fetchWeb: false });
});

test('steam-store before the store answered: local only (ADR-0036)', () => {
    assert.deepEqual(gameInfoPlan('steam-store', 'default'), { applyLocal: true, fetchWeb: false });
});

test('steam-store with no Steam match: web scraping fallback (ADR-0036)', () => {
    assert.deepEqual(gameInfoPlan('steam-store', 'default', false), { applyLocal: true, fetchWeb: true });
    assert.deepEqual(gameInfoPlan('steam-store', 'collection', false), { applyLocal: true, fetchWeb: true });
});
```

Check: `git hash-object steam-cartridges/tests/game-info-policy.test.ts` prints `6d090b96787302e9ec98d9c5598b01bce8133893`.

### Step 6: `steam-cartridges/frontend/features/game-info/index.ts` — `handleWebScrapingView(appid, storeMatched)`

**Edit 1 of 1.** Before:

```ts
const processedApps = new Set<number>();

/**
 * Game Info for one view of a shortcut that is not steam-store (dispatched by
 * features/source-view.ts). Local DB for every such shortcut; the web fetch
 * only for web-scraping games (ADR-0035, ADR-0032).
 */
export async function handleWebScrapingView(appid: number): Promise<void> {
    if (appid < NON_STEAM_APPID_MIN) return;

    const { bucket, via } = getBucket(appid);
    const plan = gameInfoPlan(bucket, via);

    if (plan.applyLocal && libraryCache.has(appid)) {
        enrichGameDetails(appid, libraryCache.get(appid)!);
```

After:

```ts
const processedApps = new Set<number>();

/**
 * Game Info for one view of a shortcut without store data (dispatched by
 * features/source-view.ts). Local DB always; the web fetch for web-scraping
 * games and for steam-store games with no Steam match (ADR-0035, ADR-0036).
 */
export async function handleWebScrapingView(appid: number, storeMatched?: boolean): Promise<void> {
    if (appid < NON_STEAM_APPID_MIN) return;

    const { bucket, via } = getBucket(appid);
    const plan = gameInfoPlan(bucket, via, storeMatched);

    if (plan.applyLocal && libraryCache.has(appid)) {
        enrichGameDetails(appid, libraryCache.get(appid)!);
```

Check: `git hash-object steam-cartridges/frontend/features/game-info/index.ts` prints `b49678e5ea9e7cd1fb2154f0fb52241a0a2371b7`.

### Step 7: `steam-cartridges/frontend/features/steam-store/index.ts` — `handleSteamStoreView` reports matched / no match / unknown

**Edit 1 of 5.** Before:

```ts
    logger.info(`Steam Store: applied ${written.length} art slot(s) from ${mapping.steam_appid} to ${appid}; ${failed.length} failed.`);
}

/** Desktop and Big Picture entry point for a steam-store game. */
export async function handleSteamStoreView(appid: number): Promise<void> {
    if (appid < NON_STEAM_APPID_MIN) return;

    const cached = metaCache.get(appid);
    if (cached) {
```

After:

```ts
    logger.info(`Steam Store: applied ${written.length} art slot(s) from ${mapping.steam_appid} to ${appid}; ${failed.length} failed.`);
}

/** Per-session answer to "did the Steam Store supply this game's Game Info?" (ADR-0036). */
const matched = new Map<number, boolean>();

/**
 * Desktop and Big Picture entry point for a steam-store game. Resolves to
 * true when store data was applied, false when there is no Steam match (or its
 * data could not load; the caller then falls back to web scraping, ADR-0036),
 * undefined when it is not known yet (title not available).
 */
export async function handleSteamStoreView(appid: number): Promise<boolean | undefined> {
    if (appid < NON_STEAM_APPID_MIN) return undefined;

    const cached = metaCache.get(appid);
    if (cached) {
```

**Edit 2 of 5.** Before:

```ts
    }
    if (processed.has(appid)) {
        const at = retryAt.get(appid);
        if (at === undefined || Date.now() < at) return;
        retryAt.delete(appid);
    }
    processed.add(appid);
```

After:

```ts
    }
    if (processed.has(appid)) {
        const at = retryAt.get(appid);
        if (at === undefined || Date.now() < at) return matched.get(appid);
        retryAt.delete(appid);
    }
    processed.add(appid);
```

**Edit 3 of 5.** Before:

```ts
        const { mapping, applied, retry, error } = await resolveMapping(appid);
        if (retry) {
            processed.delete(appid);
            return;
        }
        if (error) retryAt.set(appid, Date.now() + RETRY_MS);
        if (!mapping) return;

        const { metadata, urls } = await loadNative(appid, mapping.steam_appid);
        if (metadata) {
```

After:

```ts
        const { mapping, applied, retry, error } = await resolveMapping(appid);
        if (retry) {
            processed.delete(appid);
            return undefined;
        }
        if (error) retryAt.set(appid, Date.now() + RETRY_MS);
        if (!mapping) {
            matched.set(appid, false);
            return false;
        }

        const { metadata, urls } = await loadNative(appid, mapping.steam_appid);
        if (metadata) {
```

**Edit 4 of 5.** Before:

```ts
            if (enrichGameDetails(appid, metadata)) storeEnrichedAppIds.add(appid);
        } else {
            logger.warn(`Steam Store: no metadata for ${mapping.steam_appid}.`);
        }

        await applyArtwork(appid, mapping, applied, urls);
    } catch (err) {
        logger.warn(`Steam Store view failed for ${appid}:`, err);
    }
}
```

After:

```ts
            if (enrichGameDetails(appid, metadata)) storeEnrichedAppIds.add(appid);
        } else {
            logger.warn(`Steam Store: no metadata for ${mapping.steam_appid}.`);
            retryAt.set(appid, Date.now() + RETRY_MS);
        }
        matched.set(appid, metadata !== null);

        await applyArtwork(appid, mapping, applied, urls);
        return metadata !== null;
    } catch (err) {
        logger.warn(`Steam Store view failed for ${appid}:`, err);
        return matched.get(appid);
    }
}
```

**Edit 5 of 5.** Before:

```ts
    storeEnrichedAppIds.delete(appid);
    retryAt.delete(appid);
    artRetried.delete(appid);
}

/**
```

After:

```ts
    storeEnrichedAppIds.delete(appid);
    retryAt.delete(appid);
    artRetried.delete(appid);
    matched.delete(appid);
}

/**
```

Check: `git hash-object steam-cartridges/frontend/features/steam-store/index.ts` prints `770be3adbe1b72655eeae422b47378f3cc1c92c2`.

### Step 8: `steam-cartridges/frontend/features/source-view.ts` — Steam Store first, web fallback

**Edit 1 of 1.** Before:

```ts
            return;
        }
        if (bucket === "steam-store") {
            await handleSteamStoreView(appid);
        } else {
            // web-scraping or none. Came from steam-store: drop its Game Info first;
            // the handler then applies local data (and fetches for web-scraping only).
```

After:

```ts
            return;
        }
        if (bucket === "steam-store") {
            // ADR-0036: Steam Store first; no Steam match -> web scraping fallback;
            // not known yet (title missing) -> local Game Info only.
            const matched = await handleSteamStoreView(appid);
            if (matched !== true) await handleWebScrapingView(appid, matched);
        } else {
            // web-scraping or none. Came from steam-store: drop its Game Info first;
            // the handler then applies local data (and fetches for web-scraping only).
```

Check: `git hash-object steam-cartridges/frontend/features/source-view.ts` prints `2b1a60b4a79da8e6cd635dde6bb65f73e1db93f6`.

### Step 9: `steam-cartridges/frontend/settings/settings-panel.tsx` — rules with include / exclude, default label, Steam Store list

**Edit 1 of 7.** Before:

```tsx
    setSteamStoreMapping,
} from '../features/steam-store';
import { refreshKnownApps } from '../features/steam-store/known-apps';
import { bucketReport, listCollections, listShortcuts, shortcutName, type Bucket, type BucketsConfig } from '../features/buckets';

/**
 * Settings panel (Millennium `definePlugin` content). SDK components only, no
 * custom CSS. Reads the in-memory settings copy and live collections.
 */

const BUCKET_LABEL: Record<Bucket, string> = { 'steam-store': 'Steam Store', 'web-scraping': 'Web Scraping', none: 'Neither' };
const OPTIONS = (Object.keys(BUCKET_LABEL) as Bucket[]).map((b) => ({ data: b, label: BUCKET_LABEL[b] }));

function Buckets({ cfg, save }: { cfg: BucketsConfig; save: (c: BucketsConfig) => void }) {
    const collections = listCollections().filter((c) => !c.id.startsWith('type-') && c.id !== 'uncategorized');
    const assignedOrder = cfg.assignments.map((a) => a.id);
    const rows = [...collections].sort((a, b) => {
        const ia = assignedOrder.indexOf(a.id);
        const ib = assignedOrder.indexOf(b.id);
        return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    });

    const setBucket = (id: string, name: string, bucket: Bucket) => {
        const rest = cfg.assignments.filter((a) => a.id !== id);
        const existing = cfg.assignments.findIndex((a) => a.id === id);
        if (bucket === 'none') return save({ ...cfg, assignments: rest });
        const entry = { id, name, bucket };
        const next = [...rest];
        next.splice(existing < 0 ? next.length : existing, 0, entry);
        save({ ...cfg, assignments: next });
    };
    const move = (id: string, delta: number) => {
        const list = [...cfg.assignments];
        const i = list.findIndex((a) => a.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j]!, list[i]!];
        save({ ...cfg, assignments: list });
    };

    return (
        <DialogControlsSection>
            <DialogControlsSectionHeader>Buckets</DialogControlsSectionHeader>
            {rows.length === 0 && <div>No collections found yet.</div>}
            {rows.map((c) => {
                const a = cfg.assignments.find((x) => x.id === c.id);
                return (
                    <div key={c.id}>
                        <DropdownItem
                            label={c.name}
                            description={`${c.shortcutCount} shortcut(s)${c.dynamic ? ', dynamic' : ''}${a ? `, precedence ${assignedOrder.indexOf(c.id) + 1}` : ''}`}
                            rgOptions={OPTIONS}
                            selectedOption={a?.bucket ?? 'none'}
                            onChange={(o) => setBucket(c.id, c.name, o.data as Bucket)}
                        />
                        {a && (
                            <>
                                <ButtonItem label="Higher precedence" onClick={() => move(c.id, -1)}>Up</ButtonItem>
                                <ButtonItem label="Lower precedence" onClick={() => move(c.id, 1)}>Down</ButtonItem>
                            </>
```

After:

```tsx
    setSteamStoreMapping,
} from '../features/steam-store';
import { refreshKnownApps } from '../features/steam-store/known-apps';
import { splitPatterns } from '../features/buckets/resolve';
import {
    bucketReport,
    listCollections,
    listShortcuts,
    shortcutName,
    type Bucket,
    type BucketsConfig,
    type CollectionRule,
} from '../features/buckets';

/**
 * Settings panel (Millennium `definePlugin` content). SDK components only, no
 * custom CSS. Reads the in-memory settings copy and live collections.
 * Bucket model: ADR-0036 (default Steam Store, web fallback, per-collection
 * rules with include / exclude title patterns).
 */

const BUCKET_LABEL: Record<Bucket, string> = {
    'steam-store': 'Steam Store',
    'web-scraping': 'Web Scraping',
    none: 'Neither (no fetching)',
};
const OPTIONS = (Object.keys(BUCKET_LABEL) as Bucket[]).map((b) => ({ data: b, label: BUCKET_LABEL[b] }));

/** A collection without a rule uses the default. */
type Choice = Bucket | 'default';
const CHOICES: { data: Choice; label: string }[] = [{ data: 'default', label: 'Default (Steam Store, web fallback)' }, ...OPTIONS];

const PATTERN_HELP = 'Comma-separated. Plain text matches anywhere in the title; * and ? are wildcards over the whole title.';

function PatternField({ label, value, onCommit }: { label: string; value: string[]; onCommit: (text: string) => void }) {
    const joined = value.join(', ');
    const [text, setText] = useState(joined);
    useEffect(() => setText(joined), [joined]);
    return (
        <>
            <TextField label={label} description={PATTERN_HELP} value={text} onChange={(e) => setText(e.target.value)} />
            <ButtonItem label={`Save "${label}"`} disabled={text === joined} onClick={() => onCommit(text)}>
                Save
            </ButtonItem>
        </>
    );
}

function Buckets({ cfg, save }: { cfg: BucketsConfig; save: (c: BucketsConfig) => void }) {
    const collections = listCollections().filter((c) => !c.id.startsWith('type-') && c.id !== 'uncategorized');
    const order = cfg.rules.map((r) => r.id);
    const rows = [...collections].sort((a, b) => {
        const ia = order.indexOf(a.id);
        const ib = order.indexOf(b.id);
        return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    });

    const setChoice = (id: string, name: string, choice: Choice) => {
        const existing = cfg.rules.findIndex((r) => r.id === id);
        const rest = cfg.rules.filter((r) => r.id !== id);
        if (choice === 'default') return save({ ...cfg, rules: rest });
        const prev = cfg.rules[existing];
        const entry: CollectionRule = { id, name, bucket: choice, include: prev?.include ?? [], exclude: prev?.exclude ?? [] };
        const next = [...rest];
        next.splice(existing < 0 ? next.length : existing, 0, entry);
        save({ ...cfg, rules: next });
    };
    const setPatterns = (id: string, field: 'include' | 'exclude', text: string) =>
        save({ ...cfg, rules: cfg.rules.map((r) => (r.id === id ? { ...r, [field]: splitPatterns(text) } : r)) });
    const move = (id: string, delta: number) => {
        const list = [...cfg.rules];
        const i = list.findIndex((a) => a.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j]!, list[i]!];
        save({ ...cfg, rules: list });
    };

    return (
        <DialogControlsSection>
            <DialogControlsSectionHeader>Buckets</DialogControlsSectionHeader>
            <div>Games no rule claims use the Steam Store. A game with no Steam match falls back to Web Scraping.</div>
            <div>A game's bucket is kept for the session: collection changes apply after a restart or after any change here.</div>
            {rows.length === 0 && <div>No collections found yet.</div>}
            {rows.map((c) => {
                const rule = cfg.rules.find((x) => x.id === c.id);
                return (
                    <div key={c.id}>
                        <DropdownItem
                            label={c.name}
                            description={`${c.shortcutCount} shortcut(s)${c.dynamic ? ', dynamic' : ''}${rule ? `, precedence ${order.indexOf(c.id) + 1}` : ''}`}
                            rgOptions={CHOICES}
                            selectedOption={rule?.bucket ?? 'default'}
                            onChange={(o) => setChoice(c.id, c.name, o.data as Choice)}
                        />
                        {rule && (
                            <>
                                <PatternField label="Only titles matching" value={rule.include} onCommit={(t) => setPatterns(c.id, 'include', t)} />
                                <PatternField label="Except titles matching" value={rule.exclude} onCommit={(t) => setPatterns(c.id, 'exclude', t)} />
                                <ButtonItem label="Higher precedence" onClick={() => move(c.id, -1)}>Up</ButtonItem>
                                <ButtonItem label="Lower precedence" onClick={() => move(c.id, 1)}>Down</ButtonItem>
                            </>
```

**Edit 2 of 7.** Before:

```tsx

function SteamStore() {
    const [state, setState] = useState<StoreState | null>(null);
    const [manual, setManual] = useState<Record<number, string>>({});
    const [error, setError] = useState<string | null>(null);
    const reload = () => {
        rpc.steamStoreGetState().then(setState).catch((e) => setError(String(e)));
```

After:

```tsx

function SteamStore() {
    const [state, setState] = useState<StoreState | null>(null);
    const [target, setTarget] = useState<number | undefined>(undefined);
    const [typed, setTyped] = useState('');
    const [error, setError] = useState<string | null>(null);
    const reload = () => {
        rpc.steamStoreGetState().then(setState).catch((e) => setError(String(e)));
```

**Edit 3 of 7.** Before:

```tsx
        reload();
    }, []);

    const games = Object.entries(bucketReport().games).filter(([, g]) => g.bucket === 'steam-store').map(([id]) => Number(id));
    const run = (fn: () => Promise<unknown>) => () => {
        setError(null);
        fn().then(reload).catch((e) => setError(String(e)));
```

After:

```tsx
        reload();
    }, []);

    // Only games with something to show: a match, suggestions, or art we wrote
    // (including art left behind without a match; P4 H5). Every shortcut is
    // steam-store by default (ADR-0036), so listing them all would be ~200 rows.
    const ids = new Set<number>(
        [
            ...Object.keys(state?.mappings ?? {}),
            ...Object.keys(state?.suggestions ?? {}),
            ...Object.keys(state?.applied_artwork ?? {}),
        ].map(Number),
    );
    const games = [...ids].sort((a, b) => shortcutName(a).localeCompare(shortcutName(b)));
    const run = (fn: () => Promise<unknown>) => () => {
        setError(null);
        fn().then(reload).catch((e) => setError(String(e)));
```

**Edit 4 of 7.** Before:

```tsx
        <DialogControlsSection>
            <DialogControlsSectionHeader>Steam Store</DialogControlsSectionHeader>
            {error && <div>{error}</div>}
            {games.length === 0 && <div>No games are in the Steam Store bucket.</div>}
            {games.map((appid) => {
                const key = String(appid);
                const mapping = state?.mappings[key];
                const suggestions = state?.suggestions[key] ?? [];
                const typed = manual[appid] ?? '';
                return (
                    <div key={appid}>
                        <div>
                            {shortcutName(appid)}:{' '}
                            {mapping ? `${mapping.name || 'Steam app'} (${mapping.steam_appid}, ${mapping.source})` : 'no match'}
                        </div>
                        {mapping && (
                            <ButtonItem label="Clear this match and its artwork; it will not be applied again" onClick={run(() => clearSteamStore(appid, true))}>
                                Clear
                            </ButtonItem>
                        )}
```

After:

```tsx
        <DialogControlsSection>
            <DialogControlsSectionHeader>Steam Store</DialogControlsSectionHeader>
            {error && <div>{error}</div>}
            {games.length === 0 && <div>No Steam matches yet. Open a game's page to look it up.</div>}
            {games.map((appid) => {
                const key = String(appid);
                const mapping = state?.mappings[key];
                const applied = state?.applied_artwork[key];
                const suggestions = state?.suggestions[key] ?? [];
                const status = mapping
                    ? `${mapping.name || 'Steam app'} (${mapping.steam_appid}, ${mapping.source})`
                    : applied
                      ? `artwork from ${applied.steam_appid} but no match`
                      : 'no match';
                return (
                    <div key={appid}>
                        <div>
                            {shortcutName(appid)}: {status}
                        </div>
                        {(mapping || applied) && (
                            <ButtonItem
                                label="Clear this match and the artwork it wrote; a cleared match is not applied again"
                                onClick={run(() => clearSteamStore(appid, !!mapping))}
                            >
                                Clear
                            </ButtonItem>
                        )}
```

**Edit 5 of 7.** Before:

```tsx
                                </ButtonItem>
                            </div>
                        ))}
                        <TextField
                            label="Steam appid"
                            mustBeNumeric
                            value={typed}
                            onChange={(e) => setManual({ ...manual, [appid]: e.target.value })}
                        />
                        <ButtonItem
                            label="Use this Steam game"
                            disabled={!/^\d+$/.test(typed)}
                            onClick={run(async () => {
                                const res = await setSteamStoreMapping(appid, Number(typed));
                                if (res.error) throw new Error(res.error);
                                setManual({ ...manual, [appid]: '' });
                            })}
                        >
                            Set
                        </ButtonItem>
                    </div>
                );
            })}
        </DialogControlsSection>
    );
}
```

After:

```tsx
                                </ButtonItem>
                            </div>
                        ))}
                    </div>
                );
            })}
            <DropdownItem
                label="Match a game by hand"
                rgOptions={listShortcuts().map((s) => ({ data: s.appid, label: s.name }))}
                selectedOption={target}
                onChange={(o) => setTarget(o.data as number)}
            />
            <TextField label="Steam appid" mustBeNumeric value={typed} onChange={(e) => setTyped(e.target.value)} />
            <ButtonItem
                label="Use this Steam game"
                disabled={target === undefined || !/^\d+$/.test(typed)}
                onClick={run(async () => {
                    if (target === undefined) return;
                    const res = await setSteamStoreMapping(target, Number(typed));
                    if (res.error) throw new Error(res.error);
                    setTyped('');
                })}
            >
                Set
            </ButtonItem>
        </DialogControlsSection>
    );
}
```

**Edit 6 of 7.** Before:

```tsx
                    {m.relinkId && (
                        <ButtonItem
                            label={`A collection named "${m.name}" exists`}
                            onClick={() =>
                                save({ ...cfg, assignments: cfg.assignments.map((a) => (a.id === m.id ? { ...a, id: m.relinkId! } : a)) })
                            }
                        >
                            Re-link
                        </ButtonItem>
```

After:

```tsx
                    {m.relinkId && (
                        <ButtonItem
                            label={`A collection named "${m.name}" exists`}
                            onClick={() => save({ ...cfg, rules: cfg.rules.map((a) => (a.id === m.id ? { ...a, id: m.relinkId! } : a)) })}
                        >
                            Re-link
                        </ButtonItem>
```

**Edit 7 of 7.** Before:

```tsx
                </div>
            ))}
            {report.unbucketedWithMetadata > 0 && (
                <div>{report.unbucketedWithMetadata} game(s) have cached metadata but no bucket: they show their saved Game Info, but it is never refreshed from the web.</div>
            )}
            {report.conflicts.length === 0 && report.missing.length === 0 && report.unbucketedWithMetadata === 0 && <div>No warnings.</div>}
        </DialogControlsSection>
```

After:

```tsx
                </div>
            ))}
            {report.unbucketedWithMetadata > 0 && (
                <div>{report.unbucketedWithMetadata} game(s) with saved metadata are set to Neither: they show their saved Game Info, but it is never refreshed.</div>
            )}
            {report.conflicts.length === 0 && report.missing.length === 0 && report.unbucketedWithMetadata === 0 && <div>No warnings.</div>}
        </DialogControlsSection>
```

Check: `git hash-object steam-cartridges/frontend/settings/settings-panel.tsx` prints `da057eefc07efd1d1d41900480df2a5c827bd6b1`.

### Step 10: `steam-cartridges/tests/buckets.mjs` — CDP test for the v2 model (restores the user's setting)

**Edit 1 of 2.** Before:

```js
// CDP test for the P2 bucket engine (LIVE; not run offline). Needs Steam with
// DevTools and the fixtures from P0 T6. Usage: node tests/buckets.mjs
// Assumes the plugin's exports are reachable as PLUGIN_LIST[name] (dev copy first);
// adjust `api` below if the build exposes them elsewhere.
import { connect } from '../../enhanced-achievements/tests/cdp.mjs';

const cdp = await connect();
```

After:

```js
// CDP test for the bucket engine, ADR-0036 model (LIVE; writes plugin config, so
// run it only with the user's OK). Needs Steam with DevTools and two fixture
// collections. Usage: node tests/buckets.mjs
// Assumes the plugin's exports are reachable as PLUGIN_LIST[name] (dev copy first).
import { connect } from '../../enhanced-achievements/tests/cdp.mjs';

const cdp = await connect();
```

**Edit 2 of 2.** Before:

```js
};

const original = await ev(`${api}.bucketReport()`);
const collections = original.collections;
const find = (n) => collections.find((c) => c.name === n);
const steam = find(process.env.STEAM_COLL ?? 'SC_STEAM');
const retro = find(process.env.RETRO_COLL ?? 'SC_RETRO');
if (!steam || !retro) throw new Error('fixture collections not found (set STEAM_COLL / RETRO_COLL)');
const asg = (c, bucket) => ({ id: c.id, name: c.name, bucket });
const bucketOf = async (name) => {
    const r = await ev(`(${api}.bucketReport())`);
    const app = (await ev(`window.appStore.allApps.find(a => a.display_name === ${JSON.stringify(name)})?.appid`));
    return r.games[app]?.bucket;
};

try {
    await ev(`${api}.setSetting('buckets', { assignments: [${JSON.stringify(asg(steam, 'steam-store'))}, ${JSON.stringify(asg(retro, 'web-scraping'))}] })`);
    check('SC_RETRO_A web-scraping', (await bucketOf('SC_RETRO_A')) === 'web-scraping');
    check('SC_STEAM_OWNED steam-store', (await bucketOf('SC_STEAM_OWNED')) === 'steam-store');
    check('AM2R none', (await bucketOf('AM2R')) === 'none');
    const rep = await ev(`${api}.bucketReport()`);
    check('SC_RETRO_BOTH conflict', rep.conflicts.some((c) => c.name === 'SC_RETRO_BOTH'));

    // Without restart: move retro to Neither, then back.
    await ev(`${api}.setSetting('buckets', { assignments: [${JSON.stringify(asg(steam, 'steam-store'))}] })`);
    check('retro -> Neither reflects live', (await bucketOf('SC_RETRO_A')) === 'none');
    await ev(`${api}.setSetting('buckets', { assignments: [${JSON.stringify(asg(steam, 'steam-store'))}, ${JSON.stringify(asg(retro, 'web-scraping'))}] })`);
    check('retro back to Web Scraping', (await bucketOf('SC_RETRO_A')) === 'web-scraping');
    console.log('Manual: open SC_RETRO_A / AM2R Game Info; check logs for no "Querying IGDB metadata" for AM2R.');
} finally {
    await ev(`${api}.resetSettings()`); // TODO: restore the user's original value if it was non-default
    console.log('original buckets report collections:', original.collections.length);
}
process.exit(failed ? 1 : 0);
```

After:

```js
};

const original = await ev(`${api}.bucketReport()`);
const stored = await ev(`MILLENNIUM_API.ffi('core', 'PluginConfig_GetAll')(Object.keys(PLUGIN_LIST).includes('steam-cartridges-dev') ? 'steam-cartridges-dev' : 'steam-cartridges')`);
const collections = original.collections;
const find = (n) => collections.find((c) => c.name === n);
const steam = find(process.env.STEAM_COLL ?? 'SC_STEAM');
const retro = find(process.env.RETRO_COLL ?? 'SC_RETRO');
if (!steam || !retro) throw new Error('fixture collections not found (set STEAM_COLL / RETRO_COLL)');
const rule = (c, bucket, include = [], exclude = []) => ({ id: c.id, name: c.name, bucket, include, exclude });
const set = (rules) => ev(`${api}.setSetting('buckets', ${JSON.stringify({ rules })})`);
const bucketOf = async (name) => {
    const r = await ev(`(${api}.bucketReport())`);
    const app = await ev(`window.appStore.allApps.find(a => a.display_name === ${JSON.stringify(name)})?.appid`);
    return r.games[app]?.bucket;
};

try {
    await set([rule(steam, 'steam-store'), rule(retro, 'web-scraping')]);
    check('SC_RETRO_A web-scraping', (await bucketOf('SC_RETRO_A')) === 'web-scraping');
    check('SC_STEAM_OWNED steam-store', (await bucketOf('SC_STEAM_OWNED')) === 'steam-store');
    check('AM2R default steam-store (ADR-0036)', (await bucketOf('AM2R')) === 'steam-store');
    const rep = await ev(`${api}.bucketReport()`);
    check('SC_RETRO_BOTH conflict', rep.conflicts.some((c) => c.name === 'SC_RETRO_BOTH'));

    // Without restart: retro -> Neither, then an exclude pattern, then back.
    await set([rule(steam, 'steam-store'), rule(retro, 'none')]);
    check('retro -> Neither reflects live', (await bucketOf('SC_RETRO_A')) === 'none');
    await set([rule(steam, 'steam-store'), rule(retro, 'web-scraping', [], ['SC_RETRO_A'])]);
    check('exclude pattern falls through to the default', (await bucketOf('SC_RETRO_A')) === 'steam-store');
    await set([rule(steam, 'steam-store'), rule(retro, 'web-scraping')]);
    check('retro back to Web Scraping', (await bucketOf('SC_RETRO_A')) === 'web-scraping');
    console.log('Manual: open SC_RETRO_A / AM2R Game Info; AM2R has no Steam match, so the log shows the web fallback.');
} finally {
    const prev = typeof stored?.buckets === 'string' ? JSON.parse(stored.buckets) : stored?.buckets;
    if (prev !== undefined) await ev(`${api}.setSetting('buckets', ${JSON.stringify(prev)})`);
    else await ev(`${api}.resetSettings()`);
    console.log('restored the user\'s buckets setting');
}
process.exit(failed ? 1 : 0);
```

Check: `git hash-object steam-cartridges/tests/buckets.mjs` prints `ed6f1fbbbcab510a26404f3d709a64ee4bd8f9c3`.

### Step 11: Part A gate

```bash
cd /c/game/millennium/steam-cartridges && npm run check && npm run test:ts 2>&1 | grep -E "^ℹ (tests|pass|fail)" && npm run build 2>&1 | tail -1
```
Expected: the two `check` banner lines, nothing from `tsc`, then exactly:
```
ℹ tests 35
ℹ pass 35
ℹ fail 0
```
and a last line starting `build Succeeded`.

### Step 12: Part A docs

12a. `CHANGELOG.md`: Before:
```
## [Unreleased]

```
After:
```
## [Unreleased]

- **`steam-cartridges` ADR-0036 policy change (offline)**: shortcuts no rule claims use the Steam Store (fixed default); no Steam match falls back to web scraping; config v2 collection rules with include/exclude title patterns (v1 migrated in memory); resolutions sticky per session; settings panel updated. Plan: [docs/plans/steam-cartridges-parity.md § 4](docs/plans/steam-cartridges-parity.md#4-part-a-adr-0036-policy-change). `tsc` clean, `test:ts` 35/35. Live verification pending.

```

12b. `TASK.md`: Before:
```
    - [ ] Offline gates: `tsc`, `test:ts` 35/35
```
After:
```
    - [x] Offline gates: `tsc`, `test:ts` 35/35
```

12c. `TASK.md`: Before:
```
    - [ ] Config v2 rules and title patterns, fixed default `steam-store`, sticky resolutions
    - [ ] Store first, web fallback on no match; settings panel
```
After:
```
    - [x] Config v2 rules and title patterns, fixed default `steam-store`, sticky resolutions
    - [x] Store first, web fallback on no match; settings panel
```

### Step 13: Part A commit (do not push unless the caller said so)

Stage only your CHANGELOG bullet (the file may hold unrelated user edits):

```bash
cd /c/game/millennium && git add steam-cartridges/frontend/features/buckets/resolve.ts steam-cartridges/tests/buckets.test.ts steam-cartridges/frontend/features/buckets/index.ts steam-cartridges/frontend/features/game-info/policy.ts steam-cartridges/tests/game-info-policy.test.ts steam-cartridges/frontend/features/game-info/index.ts steam-cartridges/frontend/features/steam-store/index.ts steam-cartridges/frontend/features/source-view.ts steam-cartridges/frontend/settings/settings-panel.tsx steam-cartridges/tests/buckets.mjs TASK.md
git show HEAD:CHANGELOG.md > .git/cl_head.md
python - <<'EOF'
head = open('.git/cl_head.md', encoding='utf-8').read()
new = open('CHANGELOG.md', encoding='utf-8').read().replace('\r\n', '\n')
line = next(l for l in new.split('\n') if l.startswith('- **`steam-cartridges` ADR-0036 policy change (offline)**'))
marker = '## [Unreleased]\n\n'
assert head.count(marker) == 1
open('.git/cl_new.md', 'w', encoding='utf-8', newline='\n').write(head.replace(marker, marker + line + '\n\n'))
EOF
git diff --no-index .git/cl_head.md .git/cl_new.md | sed 's#a/.git/cl_head.md#a/CHANGELOG.md#; s#b/.git/cl_new.md#b/CHANGELOG.md#' | git apply --cached
rm -f .git/cl_head.md .git/cl_new.md
git diff --cached --stat
```
Expected: exactly 12 files: the 10 `steam-cartridges/` paths, `TASK.md`, and
`CHANGELOG.md | 2 ++`. Anything else: stop.

```bash
cd /c/game/millennium && git commit -m "feat(steam-cartridges): default Steam Store bucket with web fallback and per-collection title rules (ADR-0036)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

## 5. Parts B–E: close the parity gaps

- **B** Game Info fields: every credit through Steam's accessors (B1), both
  release dates (B2), category 39 for split-screen co-op (B3).
- **C** Steam's own Links, Friends and Community sections read the native
  appid of a mapped shortcut (C1 pure redirect, C2 components resolved once at
  startup + jsx hook, C3 `friends` / `community` in the section list).
- **D** The native app's activity events join the shortcut's feed.
- **E** A default logo position for the logo slot we wrote.
- Then the gate script (Step 28).

### Step 14: `steam-cartridges/frontend/rpc.ts` — B2 `original_release_date`

**Edit 1 of 1.** Before:

```ts
    publishers?: string[];
    franchises?: string[];
    release_date?: number;
    genres?: string[];
    categories?: GameCategories;
    custom_override?: boolean;
```

After:

```ts
    publishers?: string[];
    franchises?: string[];
    release_date?: number;
    /** First release (Early Access start) when it differs from release_date; Steam Store only. */
    original_release_date?: number;
    genres?: string[];
    categories?: GameCategories;
    custom_override?: boolean;
```

Check: `git hash-object steam-cartridges/frontend/rpc.ts` prints `141efcbd9aa60656be94bb894bcb87d6d713f803`.

### Step 15: `steam-cartridges/frontend/features/game-info/normalize.ts` — B2 normalise `original_release_date`

**Edit 1 of 1.** Before:

```ts
        franchises: strings(meta.franchises),
        genres: strings(meta.genres),
        release_date: seconds(meta.release_date),
    };
}
```

After:

```ts
        franchises: strings(meta.franchises),
        genres: strings(meta.genres),
        release_date: seconds(meta.release_date),
        original_release_date: seconds(meta.original_release_date),
    };
}
```

Check: `git hash-object steam-cartridges/frontend/features/game-info/normalize.ts` prints `17b7dd9dde01ff7f96fb57d82bedb33c5191e041`.

### Step 16: `steam-cartridges/frontend/features/steam-store/store-item.ts` — B1 every credit, B2 both dates, full data request

**Edit 1 of 3.** Before:

```ts
    const basic = item.m_BasicInfo ?? {};
    const names = (v: unknown): string[] =>
        (Array.isArray(v) ? v : []).map((x: any) => (typeof x === 'string' ? x : x?.name)).filter(Boolean);
    const description = String(basic.short_description ?? '');
    return {
        appid: shortcutAppid,
        title,
        description,
        short_description: description,
        developers: names(basic.developers),
        publishers: names(basic.publishers),
        franchises: [],
        release_date: Number(item.m_ReleaseInfo?.steam_release_date) || 0,
        categories,
        source: 'steam-store',
        steam_appid: steamAppid,
```

After:

```ts
    const basic = item.m_BasicInfo ?? {};
    const names = (v: unknown): string[] =>
        (Array.isArray(v) ? v : []).map((x: any) => (typeof x === 'string' ? x : x?.name)).filter(Boolean);
    // Steam's own accessors first (they return every credit), the raw fields second.
    const credit = (method: string, raw: unknown): string[] => {
        try {
            const v = item[method]?.();
            if (Array.isArray(v)) return names(v);
        } catch {
            /* fall through to the raw field */
        }
        return names(raw);
    };
    const description = String(basic.short_description ?? '');
    const release = Number(item.m_ReleaseInfo?.steam_release_date) || 0;
    const original = Number(item.m_ReleaseInfo?.original_steam_release_date) || 0;
    return {
        appid: shortcutAppid,
        title,
        description,
        short_description: description,
        developers: credit('GetDeveloperNames', basic.developers),
        publishers: credit('GetPublisherNames', basic.publishers),
        franchises: credit('GetFranchiseNames', basic.franchises),
        release_date: release || original,
        original_release_date: original || release,
        categories,
        source: 'steam-store',
        steam_appid: steamAppid,
```

**Edit 2 of 3.** Before:

```ts

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Queue the request and poll (Steam loads it asynchronously; ~4 s observed). */
export async function loadStoreItem(steamAppid: number, timeoutMs = 8000): Promise<any | null> {
    const cache = (window as any).StoreItemCache;
```

After:

```ts

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The item fields this plugin reads. BHasApp(id, request) is true only once all of them are loaded. */
const STORE_ITEM_REQUEST = {
    include_assets: true,
    include_basic_info: true,
    include_release: true,
    include_full_description: true,
};

/** Queue the request and poll (Steam loads it asynchronously; ~4 s observed). */
export async function loadStoreItem(steamAppid: number, timeoutMs = 8000): Promise<any | null> {
    const cache = (window as any).StoreItemCache;
```

**Edit 3 of 3.** Before:

```ts
    try {
        // Steam already failed to load it (delisted or unknown): go straight to the fallback (P4 H4).
        if (cache.BIsAppMissing?.(steamAppid)) return null;
        if (!cache.BHasApp?.(steamAppid)) {
            cache.QueueAppRequest(steamAppid, {
                include_assets: true,
                include_basic_info: true,
                include_release: true,
                include_full_description: true,
            });
        }
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (cache.BHasApp?.(steamAppid)) {
                const item = cache.GetApp?.(steamAppid);
                if (item?.m_strName) return item;
            }
```

After:

```ts
    try {
        // Steam already failed to load it (delisted or unknown): go straight to the fallback (P4 H4).
        if (cache.BIsAppMissing?.(steamAppid)) return null;
        if (!cache.BHasApp?.(steamAppid, STORE_ITEM_REQUEST)) {
            cache.QueueAppRequest(steamAppid, STORE_ITEM_REQUEST);
        }
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (cache.BHasApp?.(steamAppid, STORE_ITEM_REQUEST)) {
                const item = cache.GetApp?.(steamAppid);
                if (item?.m_strName) return item;
            }
```

Check: `git hash-object steam-cartridges/frontend/features/steam-store/store-item.ts` prints `608a83d514ba22d870fe9e9246b4865a6d1cdbe7`.

### Step 17: `steam-cartridges/frontend/features/game-info/metadata.ts` — B2 original release date, B3 category 39

**Edit 1 of 3.** Before:

```ts
 * 22: Steam Achievements
 * 24: Shared/Split Screen
 * 28: Full Controller Support
 * 37: Shared/Split Screen Co-op
 * 44: Remote Play Together
 */
export const STEAM_CATEGORIES = {
```

After:

```ts
 * 22: Steam Achievements
 * 24: Shared/Split Screen
 * 28: Full Controller Support
 * 39: Shared/Split Screen Co-op (37 is Shared/Split Screen PvP)
 * 44: Remote Play Together
 */
export const STEAM_CATEGORIES = {
```

**Edit 2 of 3.** Before:

```ts
    ACHIEVEMENTS: 22,
    SPLIT_SCREEN: 24,
    FULL_CONTROLLER: 28,
    SPLIT_SCREEN_COOP: 37,
    REMOTE_PLAY_TOGETHER: 44,
} as const;
```

After:

```ts
    ACHIEVEMENTS: 22,
    SPLIT_SCREEN: 24,
    FULL_CONTROLLER: 28,
    SPLIT_SCREEN_COOP: 39,
    REMOTE_PLAY_TOGETHER: 44,
} as const;
```

**Edit 3 of 3.** Before:

```ts

                // Release Date
                if (meta.release_date && meta.release_date > 0) {
                    overview.rt_original_release_date = meta.release_date;
                    overview.rt_steam_release_date = meta.release_date;
                }
```

After:

```ts

                // Release Date
                if (meta.release_date && meta.release_date > 0) {
                    // Same two fields a native overview carries (parity plan B3).
                    overview.rt_original_release_date = meta.original_release_date || meta.release_date;
                    overview.rt_steam_release_date = meta.release_date;
                }
```

Check: `git hash-object steam-cartridges/frontend/features/game-info/metadata.ts` prints `5a858982c24a8a63e4b673d84cbba8214ee92ba9`.

### Step 18: `steam-cartridges/tests/steam-store.test.ts` — B1/B2 unit test

**Edit 1 of 1.** Before:

```ts
    assert.equal(meta?.categories?.multiplayer, false);
    assert.equal(metadataFromStoreItem({}, 1, 2), null);
});
```

After:

```ts
    assert.equal(meta?.categories?.multiplayer, false);
    assert.equal(metadataFromStoreItem({}, 1, 2), null);
});

test('StoreItemCache accessors win over raw fields; both release dates kept (parity B)', () => {
    const meta = metadataFromStoreItem(
        {
            m_strName: 'Jotunnslayer: Hordes of Hel',
            m_BasicInfo: { short_description: 'Slay.', developers: [{ name: 'Games Farm' }], publishers: [] },
            m_ReleaseInfo: { steam_release_date: 1756917692, original_steam_release_date: 1737464732 },
            GetDeveloperNames: () => ['Games Farm', 'ARTillery'],
            GetPublisherNames: () => ['Grindstone'],
            GetFranchiseNames: () => { throw new Error('not loaded'); },
        },
        2820820,
        2315502503,
    );
    assert.deepEqual(meta?.developers, ['Games Farm', 'ARTillery']);
    assert.deepEqual(meta?.publishers, ['Grindstone']);
    assert.deepEqual(meta?.franchises, [], 'a throwing accessor falls back to the raw field');
    assert.equal(meta?.release_date, 1756917692);
    assert.equal(meta?.original_release_date, 1737464732);
    const noOriginal = metadataFromStoreItem({ m_strName: 'x', m_ReleaseInfo: { steam_release_date: 5 } }, 1, 2);
    assert.equal(noOriginal?.original_release_date, 5);
});
```

Check: `git hash-object steam-cartridges/tests/steam-store.test.ts` prints `69d8a4e96cfbb0fba35a32053ccf357dcb5c79fc`.

### Step 19: `steam-cartridges/frontend/features/steam-store/native-sections-core.ts` (new file) — C1 pure prop redirection

Create with exactly:

```ts
/**
 * Pure part of the section appid redirection (parity plan C). No imports, so
 * Node can run the unit tests with type stripping.
 *
 * Steam's own Links, Friends and Community sections load their data by appid
 * (`overview.appid`, `details.unAppID`, `appid`). For a shortcut with a Steam
 * match we hand them the native appid, so Steam fetches and renders the native
 * game's links, friends who play and community content itself (ADR-0022,
 * ADR-0009). A shortcut without a match gets Steam's stock behaviour: no links
 * (a shortcut's own appid has no store page).
 */
export type RedirectKind = 'links' | 'friends' | 'community';

export const SHORTCUT_MIN = 0x8000_0000;

const proxies = new WeakMap<object, Map<number, object>>();

/** One proxy per (target, native) so React sees a stable object across renders. */
function cached<T extends object>(target: T, key: number, make: () => T): T {
    let byKey = proxies.get(target);
    if (!byKey) {
        byKey = new Map();
        proxies.set(target, byKey);
    }
    let p = byKey.get(key) as T | undefined;
    if (!p) {
        p = make();
        byKey.set(key, p);
    }
    return p;
}

/** Reads go to the target (getters run with the target as `this`); methods stay bound to it. */
function passThrough(t: object, prop: string | symbol): unknown {
    const v = Reflect.get(t, prop, t);
    return typeof v === 'function' ? v.bind(t) : v;
}

/** The overview the Links component sees. native undefined = stock shortcut behaviour (no links). */
export function linksOverview<T extends object>(overview: T, native: number | undefined): T {
    return cached(overview, native ?? 0, () =>
        new Proxy(overview, {
            get(t, prop) {
                if (prop === 'BIsModOrShortcut') return native === undefined ? () => true : () => false;
                if (native !== undefined && prop === 'appid') return native;
                return passThrough(t, prop);
            },
        }),
    );
}

/** The details the Friends components see: `unAppID` is the native app. */
export function nativeDetails<T extends object>(details: T, native: number): T {
    return cached(details, native, () =>
        new Proxy(details, {
            get(t, prop) {
                if (prop === 'unAppID') return native;
                return passThrough(t, prop);
            },
        }),
    );
}

/**
 * Rewrite one element's props in place (the jsx hook passes the props object
 * before React sees it). Returns the native appid used, or undefined when
 * nothing changed. O(1).
 */
export function redirectProps(
    kind: RedirectKind,
    props: Record<string, any> | null | undefined,
    nativeOf: (appid: number) => number | undefined,
): number | undefined {
    if (!props) return undefined;
    if (kind === 'links') {
        const ov = props.overview;
        if (!ov || typeof ov !== 'object' || !(ov.appid >= SHORTCUT_MIN)) return undefined;
        const native = nativeOf(ov.appid);
        props.overview = linksOverview(ov, native);
        return native ?? 0;
    }
    if (kind === 'friends') {
        const d = props.details;
        if (!d || typeof d !== 'object' || !(d.unAppID >= SHORTCUT_MIN)) return undefined;
        const native = nativeOf(d.unAppID);
        if (native === undefined) return undefined;
        props.details = nativeDetails(d, native);
        return native;
    }
    const appid = props.appid;
    if (!(appid >= SHORTCUT_MIN)) return undefined;
    const native = nativeOf(appid);
    if (native === undefined) return undefined;
    props.appid = native;
    return native;
}
```

Check: `git hash-object steam-cartridges/frontend/features/steam-store/native-sections-core.ts` prints `723e4423c82f590ad8edd683f1420b411c133f1b`.

### Step 20: `steam-cartridges/tests/native-sections.test.ts` (new file) — C1 unit tests

Create with exactly:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linksOverview, nativeDetails, redirectProps } from '../frontend/features/steam-store/native-sections-core.ts';

const SHORTCUT = 2315502503;
const NATIVE = 2820820;
const nativeOf = (appid: number) => (appid === SHORTCUT ? NATIVE : undefined);

function overview(appid: number) {
    return {
        appid,
        app_type: 1,
        get label() {
            return `app ${this.appid}`;
        },
        BIsModOrShortcut() {
            return false;
        },
    };
}

test('links: a mapped shortcut shows the native links', () => {
    const props: Record<string, any> = { overview: overview(SHORTCUT), details: {} };
    assert.equal(redirectProps('links', props, nativeOf), NATIVE);
    assert.equal(props.overview.appid, NATIVE);
    assert.equal(props.overview.BIsModOrShortcut(), false);
    assert.equal(props.overview.label, `app ${SHORTCUT}`, 'getters run against the real overview');
    assert.equal(props.overview.app_type, 1);
});

test('links: an unmapped shortcut gets Steam stock behaviour (no links)', () => {
    const props: Record<string, any> = { overview: overview(4263274102) };
    assert.equal(redirectProps('links', props, nativeOf), 0);
    assert.equal(props.overview.appid, 4263274102);
    assert.equal(props.overview.BIsModOrShortcut(), true);
});

test('links: native apps are untouched', () => {
    const ov = overview(435150);
    const props: Record<string, any> = { overview: ov };
    assert.equal(redirectProps('links', props, nativeOf), undefined);
    assert.equal(props.overview, ov);
});

test('friends: details.unAppID becomes the native appid, other fields pass through', () => {
    const details = { unAppID: SHORTCUT, strDisplayName: 'x' };
    const props: Record<string, any> = { details };
    assert.equal(redirectProps('friends', props, nativeOf), NATIVE);
    assert.equal(props.details.unAppID, NATIVE);
    assert.equal(props.details.strDisplayName, 'x');
    const unmapped: Record<string, any> = { details: { unAppID: 4263274102 } };
    assert.equal(redirectProps('friends', unmapped, nativeOf), undefined);
    assert.equal(unmapped.details.unAppID, 4263274102);
});

test('community: appid prop becomes the native appid', () => {
    const props: Record<string, any> = { appid: SHORTCUT };
    assert.equal(redirectProps('community', props, nativeOf), NATIVE);
    assert.equal(props.appid, NATIVE);
    assert.equal(redirectProps('community', { appid: 435150 }, nativeOf), undefined);
    assert.equal(redirectProps('community', null, nativeOf), undefined);
});

test('proxies are stable per (target, native) so React sees one object', () => {
    const ov = overview(SHORTCUT);
    assert.equal(linksOverview(ov, NATIVE), linksOverview(ov, NATIVE));
    const d = { unAppID: SHORTCUT };
    assert.equal(nativeDetails(d, NATIVE), nativeDetails(d, NATIVE));
});
```

Check: `git hash-object steam-cartridges/tests/native-sections.test.ts` prints `5337eb632b686544766b752d59025c49a68b3372`.

### Step 21: `steam-cartridges/frontend/features/game-info/game-info-patch.ts` — C2 export `getSteamRequire`

**Edit 1 of 1.** Before:

```ts

let cachedRequire: WebpackRequire | undefined;

function getSteamRequire(): WebpackRequire | undefined {
    if (cachedRequire) return cachedRequire;
    try {
        const chunks = (window as any).webpackChunksteamui as
```

After:

```ts

let cachedRequire: WebpackRequire | undefined;

export function getSteamRequire(): WebpackRequire | undefined {
    if (cachedRequire) return cachedRequire;
    try {
        const chunks = (window as any).webpackChunksteamui as
```

Check: `git hash-object steam-cartridges/frontend/features/game-info/game-info-patch.ts` prints `d888729c5f8ea9e9c9bbbcf5bb7a1003324db0da`.

### Step 22: `steam-cartridges/frontend/features/steam-store/native-sections.ts` (new file) — C2 resolve Links/Friends/Community once, jsx hook

Create with exactly:

```ts
import { findModuleByExport } from "@steambrew/client";
import { logger } from "../../logger";
import { keepJsxPatched, type JsxHookDiagnostics } from "../../steam/jsx-hook";
import { getSteamRequire } from "../game-info/game-info-patch";
import { redirectProps, type RedirectKind } from "./native-sections-core";

/**
 * Hands Steam's own Links, Friends and Community sections the native appid of
 * a mapped shortcut (parity plan C; pure logic in native-sections-core.ts).
 *
 * The three components are resolved ONCE at startup (guardrail 3) by their
 * webpack factory source, keyed on localisation tokens (steam-debug.md § 3.2).
 * Each signature must match exactly one module, or that kind is skipped and
 * the section stays stock. Verified 2026-09-24: links -> module exporting the
 * links bar used by desktop and Big Picture Game Info; friends -> the module
 * with the Friends section (desktop `{details}`, Big Picture `{details}`);
 * community -> the Community Content section (`{appid}`).
 *
 * The jsx handler is O(1) (guardrail 2): one Map lookup on the element type,
 * then one on the appid.
 */
const SIGNATURES: [RedirectKind, string[]][] = [
    ["links", ['"#AppDetails_Links_Store"', '"primarylinks"']],
    ["friends", ['"CommunityFriendsThatPlay"', '"#AppDetails_SectionTitle_Friends"']],
    ["community", ['"#AppDetails_SectionTitle_Community"', "LoadAdditionalContent"]],
];

/** Element type -> kind. Every export of a matched module (only matching props are touched). */
const TYPES = new Map<unknown, RedirectKind>();
/** Shortcut appid -> native appid, for mapped steam-store games. */
const nativeFor = new Map<number, number>();
const counts: Record<RedirectKind, number> = { links: 0, friends: 0, community: 0 };
const lastNative: Partial<Record<RedirectKind, number>> = {};

export function setNativeAppid(appid: number, nativeAppid: number | undefined): void {
    if (nativeAppid === undefined) nativeFor.delete(appid);
    else nativeFor.set(appid, nativeAppid);
}

const nativeOf = (appid: number) => nativeFor.get(appid);

function resolveTypes(): void {
    const req = getSteamRequire();
    if (!req?.m) {
        logger.warn("Webpack require unavailable; native sections stay stock.");
        return;
    }
    const hits: Record<RedirectKind, string[]> = { links: [], friends: [], community: [] };
    for (const id of Object.keys(req.m)) {
        let src: string;
        try {
            src = Function.prototype.toString.call(req.m[id]);
        } catch {
            continue;
        }
        for (const [kind, needles] of SIGNATURES) {
            if (needles.every((n) => src.includes(n))) hits[kind].push(id);
        }
    }
    for (const [kind] of SIGNATURES) {
        if (hits[kind].length !== 1) {
            logger.warn(`Native ${kind} section: ${hits[kind].length} module matches (need 1); left stock.`);
            continue;
        }
        let exp: any;
        try {
            exp = req(hits[kind][0]!);
        } catch {
            continue;
        }
        for (const key of Object.keys(exp ?? {})) {
            const v = exp[key];
            if (v && (typeof v === "function" || typeof v === "object")) TYPES.set(v, kind);
        }
    }
}

function findJsxRuntime(): Record<"jsx" | "jsxs", (type: unknown, props: unknown, key?: unknown) => unknown> | undefined {
    const found = findModuleByExport(
        (moduleExport: unknown, exportName?: unknown) =>
            (exportName === "jsx" || exportName === "jsxs") && typeof moduleExport === "function",
    ) as any;
    return found && typeof found.jsx === "function" && typeof found.jsxs === "function" ? found : undefined;
}

let hook: ReturnType<typeof keepJsxPatched> | undefined;

/** Resolve the components and install the jsx handler. Idempotent; a failure leaves Steam stock. */
export function installNativeSections(): void {
    if (hook) return;
    try {
        resolveTypes();
        if (TYPES.size === 0) return;
        const runtime = findJsxRuntime();
        if (!runtime) {
            logger.warn("Could not find react/jsx-runtime; native sections stay stock.");
            return;
        }
        hook = keepJsxPatched(runtime, {
            label: "steam-cartridges.native-sections",
            observe: (type, props) => {
                const kind = TYPES.get(type);
                if (kind === undefined) return;
                const used = redirectProps(kind, props as Record<string, any>, nativeOf);
                if (used !== undefined) {
                    counts[kind]++;
                    lastNative[kind] = used;
                }
            },
        });
        logger.info(`Native sections redirect installed (${TYPES.size} component exports).`);
    } catch (err) {
        logger.warn("Native sections redirect failed; sections stay stock.", err);
    }
}

/** For CDP checks (PLUGIN_LIST[...].nativeSectionsDiagnostics()). */
export function nativeSectionsDiagnostics(): {
    kinds: RedirectKind[];
    counts: Record<RedirectKind, number>;
    lastNative: Partial<Record<RedirectKind, number>>;
    mapped: Record<number, number>;
    jsx: JsxHookDiagnostics[];
} {
    return {
        kinds: [...new Set(TYPES.values())],
        counts: { ...counts },
        lastNative: { ...lastNative },
        mapped: Object.fromEntries(nativeFor),
        jsx: hook?.diagnostics() ?? [],
    };
}
```

Check: `git hash-object steam-cartridges/frontend/features/steam-store/native-sections.ts` prints `4d4088c1fe7f493a780acee85b05ab475bacdf22`.

### Step 23: `steam-cartridges/frontend/steam/sections.ts` — C3 extra sections per mapped shortcut

**Edit 1 of 3.** Before:

```ts
const appsWithContent = new Set<number>();

/**
 * Tell the section registry this app gained or lost a summary.
 *
 * The publish is async, so Steam has already rendered the page by the time it
```

After:

```ts
const appsWithContent = new Set<number>();

/**
 * Extra Steam sections per shortcut (parity plan C3). A shortcut with a Steam
 * Store match gets Steam's own `friends` and `community` sections, which then
 * load the native app's data (features/steam-store/native-sections.ts).
 */
const extraSections = new Map<number, readonly string[]>();

/** Set (or with `undefined`, drop) the extra sections for one shortcut; re-renders on change. */
export function setExtraSections(appid: number, names: readonly string[] | undefined): void {
    const before = extraSections.get(appid)?.join(",") ?? "";
    const after = names?.join(",") ?? "";
    if (before === after) return;
    if (names && names.length > 0) extraSections.set(appid, names);
    else extraSections.delete(appid);
    refreshInstances();
}

/**
 * Tell the section registry this app gained or lost a summary.
 *
 * The publish is async, so Steam has already rendered the page by the time it
```

**Edit 2 of 3.** Before:

```ts
        try {
            for (const name of RESTORED_SECTIONS) sections.add(name);

            // Only drop a section once we have something in its place; otherwise the
            // page loses an explanation and gains nothing. Empty today - see
            // REPLACED_SECTIONS.
            const appid = (overview as AppOverview | undefined)?.appid;
            if (appid !== undefined && appsWithContent.has(appid)) {
                for (const name of REPLACED_SECTIONS) sections.delete(name);
            }
```

After:

```ts
        try {
            for (const name of RESTORED_SECTIONS) sections.add(name);

            const appid = (overview as AppOverview | undefined)?.appid;
            const extra = appid !== undefined ? extraSections.get(appid) : undefined;
            if (extra) for (const name of extra) sections.add(name);

            // Only drop a section once we have something in its place; otherwise the
            // page loses an explanation and gains nothing. Empty today - see
            // REPLACED_SECTIONS.
            if (appid !== undefined && appsWithContent.has(appid)) {
                for (const name of REPLACED_SECTIONS) sections.delete(name);
            }
```

**Edit 3 of 3.** Before:

```ts
    patchedProto = undefined;

    appsWithContent.clear();
    refreshInstances();
    instances.clear();
}
```

After:

```ts
    patchedProto = undefined;

    appsWithContent.clear();
    extraSections.clear();
    refreshInstances();
    instances.clear();
}
```

Check: `git hash-object steam-cartridges/frontend/steam/sections.ts` prints `ede220eace38eca16bd2fe2c27efc931343acf68`.

### Step 24: `steam-cartridges/frontend/index.tsx` — C2 install at startup, diagnostics export

**Edit 1 of 3.** Before:

```tsx
import { NON_STEAM_APPID_MIN, appIdFromPath } from "./steam/route";
import { initGameInfo } from "./features/game-info";
import { initSourceView } from "./features/source-view";
import { initSettings, resetSettings, setSetting } from "./settings/settings";
import { SettingsPanel } from "./settings/settings-panel";
```

After:

```tsx
import { NON_STEAM_APPID_MIN, appIdFromPath } from "./steam/route";
import { initGameInfo } from "./features/game-info";
import { initSourceView } from "./features/source-view";
import { installNativeSections } from "./features/steam-store/native-sections";
import { initSettings, resetSettings, setSetting } from "./settings/settings";
import { SettingsPanel } from "./settings/settings-panel";
```

**Edit 2 of 3.** Before:

```tsx
export { jsxDiagnostics } from "./steam/gamepad-appid";
export { headlineJsxDiagnostics } from "./steam/headline-patch";
export { activityCardsJsxDiagnostics } from "./steam/activity-cards-patch";
export type {
    SummaryContext,
    SummaryContribution,
```

After:

```tsx
export { jsxDiagnostics } from "./steam/gamepad-appid";
export { headlineJsxDiagnostics } from "./steam/headline-patch";
export { activityCardsJsxDiagnostics } from "./steam/activity-cards-patch";
export { nativeSectionsDiagnostics } from "./features/steam-store/native-sections";
export type {
    SummaryContext,
    SummaryContribution,
```

**Edit 3 of 3.** Before:

```tsx
    // (PostGameSummaryClip and SummaryScreenshot) with hover video scrubbers and native playback.
    installActivityCardsPatch();

    // ===== Game Info (ex steamgriddb-artwork) =====
    // Not awaited: the two halves load independently, as the two plugins did
    // (ADR-0010), and a failure here must not affect activity.
```

After:

```tsx
    // (PostGameSummaryClip and SummaryScreenshot) with hover video scrubbers and native playback.
    installActivityCardsPatch();

    // ===== Native sections for mapped games (parity plan C) =====
    // Steam's own Links / Friends / Community sections read the native appid
    // of a Steam Store match; unmatched shortcuts keep Steam's stock sections.
    installNativeSections();

    // ===== Game Info (ex steamgriddb-artwork) =====
    // Not awaited: the two halves load independently, as the two plugins did
    // (ADR-0010), and a failure here must not affect activity.
```

Check: `git hash-object steam-cartridges/frontend/index.tsx` prints `3683ae0bad1fcdaa09d2b450592ed31a615cca01`.

### Step 25: `steam-cartridges/frontend/steam/activity.ts` — D native news in the shortcut's feed

**Edit 1 of 4.** Before:

```ts
    workshopStore,
    type AppActivity,
    type AppActivityDay,
    type SteamClip,
    type SteamScreenshot,
} from "./stores";
```

After:

```ts
    workshopStore,
    type AppActivity,
    type AppActivityDay,
    type AppActivityStore,
    type SteamClip,
    type SteamScreenshot,
} from "./stores";
```

**Edit 2 of 4.** Before:

```ts
/** Apps with fake in-memory StoreItems injected into StoreItemCache. */
const injectedStoreApps = new Set<number>();

/** Compute local midnight in unix seconds for a given timestamp. */
function getLocalMidnight(timestamp: number): number {
    const d = new Date(timestamp * 1000);
```

After:

```ts
/** Apps with fake in-memory StoreItems injected into StoreItemCache. */
const injectedStoreApps = new Set<number>();

/**
 * Shortcut appid -> native appid whose Steam activity (partner events / news,
 * friend events) joins the shortcut's feed (parity plan D). Set by the Steam
 * Store bucket for mapped games only.
 */
const nativeActivitySource = new Map<number, number>();

export function setNativeActivitySource(appid: number, nativeAppid: number | undefined): void {
    if (nativeAppid === undefined) nativeActivitySource.delete(appid);
    else nativeActivitySource.set(appid, nativeAppid);
}

/**
 * Steam's own activity for a native app, as [day key, day] pairs. `GetAppActivity`
 * makes Steam restore its cache and fetch from the server (verified live
 * 2026-09-25: unowned 2820820 returned one partner event, type 1002). A native
 * day's `m_rtDayBegin` is unset, so the key comes from `m_mapActivityByDay`.
 * Polls until Steam stops loading, at most 8 s.
 */
async function nativeActivityDays(nativeAppid: number | undefined): Promise<[number, AppActivityDay][]> {
    const store = appActivityStore() as (AppActivityStore & { m_setAppsLoading?: Set<number>; m_setAppFetchRequested?: Set<number> }) | undefined;
    if (nativeAppid === undefined || !store) return [];
    for (let i = 0; i < 16; i++) {
        const entry = store.GetAppActivity(nativeAppid);
        const busy = store.m_setAppsLoading?.has(nativeAppid) || store.m_setAppFetchRequested?.has(nativeAppid);
        if (entry && !busy) return [...entry.m_mapActivityByDay.entries()];
        await new Promise((r) => setTimeout(r, 500));
    }
    const entry = store.m_mapAppActivity.get(nativeAppid);
    return entry ? [...entry.m_mapActivityByDay.entries()] : [];
}

/** Compute local midnight in unix seconds for a given timestamp. */
function getLocalMidnight(timestamp: number): number {
    const d = new Date(timestamp * 1000);
```

**Edit 3 of 4.** Before:

```ts
    appid: number,
    gameid: string,
): Promise<number> {
    const [screenshots, clips] = await Promise.all([
        screenshotsSince(appid, 0),
        clipsSince(gameid, 0),
    ]);
    if (screenshots.length === 0 && clips.length === 0) return 0;

    const actStore = appActivityStore();
    const storeCache = storeItemCache();
```

After:

```ts
    appid: number,
    gameid: string,
): Promise<number> {
    const [screenshots, clips, nativeDays] = await Promise.all([
        screenshotsSince(appid, 0),
        clipsSince(gameid, 0),
        nativeActivityDays(nativeActivitySource.get(appid)),
    ]);
    if (screenshots.length === 0 && clips.length === 0 && nativeDays.length === 0) return 0;

    const actStore = appActivityStore();
    const storeCache = storeItemCache();
```

**Edit 4 of 4.** Before:

```ts
        }
    }

    registeredFilesByApp.set(appid, fileIdsForApp);
    logger.info(
        `Published ${mediaItems.length} capture(s) (${screenshots.length} shot(s), ${clips.length} clip(s)) across ${byDay.size} day(s) in activity feed for ${appid}.`,
    );
    return mediaItems.length;
}

/** Drop an app's activity feed entries and associated fake store/workshop records. */
```

After:

```ts
        }
    }

    // Native news and friend events for a mapped shortcut (parity plan D): Steam's
    // own event objects, added to the same local day as our captures.
    const NativeDay = (CDay ?? nativeDays[0]?.[1]?.constructor) as (new () => AppActivityDay) | undefined;
    let nativeEvents = 0;
    for (const [nativeKey, nativeDay] of nativeDays) {
        const dayBegin = getLocalMidnight(nativeKey);
        let day = appActivity.m_mapActivityByDay.get(dayBegin);
        if (!day) {
            if (!NativeDay) continue;
            day = new NativeDay();
            day.m_rtDayBegin = dayBegin;
            appActivity.m_mapActivityByDay.set(dayBegin, day);
        }
        for (const event of [...(nativeDay.m_rgEvents ?? [])]) {
            day.m_rgEvents.push(event);
            nativeEvents++;
        }
        day.SortEvents?.();
    }

    registeredFilesByApp.set(appid, fileIdsForApp);
    logger.info(
        `Published ${mediaItems.length} capture(s) (${screenshots.length} shot(s), ${clips.length} clip(s)) and ${nativeEvents} native event(s) across ${appActivity.m_mapActivityByDay.size} day(s) in activity feed for ${appid}.`,
    );
    return mediaItems.length + nativeEvents;
}

/** Drop an app's activity feed entries and associated fake store/workshop records. */
```

Check: `git hash-object steam-cartridges/frontend/steam/activity.ts` prints `70e2cb151cdfdbe4fb58bfd8face406cdd75ab56`.

### Step 26: `steam-cartridges/frontend/features/steam-store/logo.ts` (new file) — E default logo position

Create with exactly:

```ts
import { logger } from "../../logger";

/**
 * A shortcut's custom logo stays hidden until it has a logo position (parity
 * plan § 1, traced live 2026-09-24): Steam's app header (`TopCapsule`) draws
 * the logo only when `logoPosition !== null`, and for an app without library
 * assets `GetLogoImagesForAppId` reports `null`. Steam's own "Adjust logo
 * position" stores one through `appDetailsStore.SaveCustomLogoPosition`
 * (`<grid>/<appid>.json`); we call the same method with Steam's own default
 * (TopCapsule's fallback `{ BottomLeft, 50, 50 }`).
 */
const DEFAULT_LOGO_POSITION = { pinnedPosition: "BottomLeft", nWidthPct: 50, nHeightPct: 50 };

function handles(appid: number): { store: any; overview: any } | null {
    const store = (window as any).appDetailsStore;
    const overview = (window as any).appStore?.GetAppOverviewByAppID?.(appid);
    return store && overview ? { store, overview } : null;
}

/** Give our logo a position unless one exists (a position the user set is kept). */
export async function ensureLogoPosition(appid: number): Promise<void> {
    try {
        const h = handles(appid);
        if (!h || typeof h.store.SaveCustomLogoPosition !== "function") return;
        await h.store.RequestCustomImageInfo?.(h.overview); // loads <grid>/<appid>.json if present
        if (h.store.GetAppData?.(appid)?.customImageInfo?.logoPosition) return;
        await h.store.SaveCustomLogoPosition(h.overview, DEFAULT_LOGO_POSITION);
        logger.info(`Steam Store: saved a default logo position for ${appid}.`);
    } catch (err) {
        logger.warn(`Could not save a logo position for ${appid}:`, err);
    }
}

/** Remove the logo position together with the logo slot we wrote. */
export async function clearLogoPosition(appid: number): Promise<void> {
    try {
        const h = handles(appid);
        await h?.store.ClearCustomLogoPosition?.(h.overview);
    } catch (err) {
        logger.warn(`Could not clear the logo position for ${appid}:`, err);
    }
}
```

Check: `git hash-object steam-cartridges/frontend/features/steam-store/logo.ts` prints `832b3e55b07c5ede92b15aa2ff4161fdb4cf3b75`.

### Step 27: `steam-cartridges/frontend/features/steam-store/index.ts` — C/D/E wiring for a mapped game

**Edit 1 of 7.** Before:

```ts
} from "../../rpc";
import { resolveShortcutTitle } from "../../steam/shortcut";
import { applyCustomArtworkFromUrls } from "../artwork/artwork";
import { enrichGameDetails, revertGameDetails } from "../game-info/metadata";
import { normalizeMetadata } from "../game-info/normalize";
import { NON_STEAM_APPID_MIN } from "../../steam/route";
import { artworkPlan, mergeArtResult, pickUrls, slotList } from "./art-plan";
import { storeEnrichedAppIds } from "./enriched";
import { knownAppName, matchKnownNative } from "./known-apps";
import { cdnArtworkUrls } from "./resolve";
import { assetUrlsFromItem, loadStoreItem, metadataFromStoreItem } from "./store-item";
```

After:

```ts
} from "../../rpc";
import { resolveShortcutTitle } from "../../steam/shortcut";
import { applyCustomArtworkFromUrls } from "../artwork/artwork";
import { refreshGameInfoInstances } from "../game-info/game-info-patch";
import { enrichGameDetails, revertGameDetails } from "../game-info/metadata";
import { normalizeMetadata } from "../game-info/normalize";
import { NON_STEAM_APPID_MIN } from "../../steam/route";
import { setNativeActivitySource } from "../../steam/activity";
import { setExtraSections } from "../../steam/sections";
import { patch as patchLibraryApp } from "../../renderers/library-app";
import { artworkPlan, mergeArtResult, pickUrls, slotList } from "./art-plan";
import { storeEnrichedAppIds } from "./enriched";
import { knownAppName, matchKnownNative } from "./known-apps";
import { clearLogoPosition, ensureLogoPosition } from "./logo";
import { setNativeAppid } from "./native-sections";
import { cdnArtworkUrls } from "./resolve";
import { assetUrlsFromItem, loadStoreItem, metadataFromStoreItem } from "./store-item";
```

**Edit 2 of 7.** Before:

```ts
    return { metadata, urls };
}

async function applyArtwork(appid: number, mapping: StoreMapping, applied: StoreApplied | null, urls: Loaded["urls"]) {
    const plan = artworkPlan(applied, mapping.steam_appid, artRetried.has(appid));
    if (applied?.steam_appid === mapping.steam_appid) artRetried.add(appid);
    if (plan.write.length === 0) return;

    const apps = (window as any).SteamClient?.Apps; // call on the object; never extract the method
    // A different game was mapped before: clear only the slots this plugin wrote.
```

After:

```ts
    return { metadata, urls };
}

/** Returns the slots recorded as ours afterwards. */
async function applyArtwork(
    appid: number,
    mapping: StoreMapping,
    applied: StoreApplied | null,
    urls: Loaded["urls"],
): Promise<number[]> {
    const plan = artworkPlan(applied, mapping.steam_appid, artRetried.has(appid));
    if (applied?.steam_appid === mapping.steam_appid) artRetried.add(appid);
    if (plan.write.length === 0) return slotList(applied?.slots);

    const apps = (window as any).SteamClient?.Apps; // call on the object; never extract the method
    // A different game was mapped before: clear only the slots this plugin wrote.
```

**Edit 3 of 7.** Before:

```ts
            } catch {}
        }
        logger.warn(`Steam Store: art for ${appid} discarded (${res.error}).`);
        return;
    }
    logger.info(`Steam Store: applied ${written.length} art slot(s) from ${mapping.steam_appid} to ${appid}; ${failed.length} failed.`);
}

/** Per-session answer to "did the Steam Store supply this game's Game Info?" (ADR-0036). */
const matched = new Map<number, boolean>();
```

After:

```ts
            } catch {}
        }
        logger.warn(`Steam Store: art for ${appid} discarded (${res.error}).`);
        return [];
    }
    logger.info(`Steam Store: applied ${written.length} art slot(s) from ${mapping.steam_appid} to ${appid}; ${failed.length} failed.`);
    return slots;
}

/** Steam sections a mapped shortcut gets back (parity plan C3; data comes from the native app). */
const NATIVE_SECTIONS = ["friends", "community"] as const;

/** Per-session answer to "did the Steam Store supply this game's Game Info?" (ADR-0036). */
const matched = new Map<number, boolean>();
```

**Edit 4 of 7.** Before:

```ts
            return false;
        }

        const { metadata, urls } = await loadNative(appid, mapping.steam_appid);
        if (metadata) {
            metaCache.set(appid, metadata);
```

After:

```ts
            return false;
        }

        // Parity C + D: Steam's own Links/Friends/Community sections and activity
        // feed read the native app; re-publish so the feed picks up its events.
        setNativeAppid(appid, mapping.steam_appid);
        setNativeActivitySource(appid, mapping.steam_appid);
        setExtraSections(appid, NATIVE_SECTIONS);
        refreshGameInfoInstances(); // guardrail 11: the sections already rendered with the shortcut appid
        void patchLibraryApp(appid);

        const { metadata, urls } = await loadNative(appid, mapping.steam_appid);
        if (metadata) {
            metaCache.set(appid, metadata);
```

**Edit 5 of 7.** Before:

```ts
        }
        matched.set(appid, metadata !== null);

        await applyArtwork(appid, mapping, applied, urls);
        return metadata !== null;
    } catch (err) {
        logger.warn(`Steam Store view failed for ${appid}:`, err);
```

After:

```ts
        }
        matched.set(appid, metadata !== null);

        const slots = await applyArtwork(appid, mapping, applied, urls);
        // Parity E: our logo needs a position or Steam never draws it.
        if (slots.includes(2)) await ensureLogoPosition(appid);
        return metadata !== null;
    } catch (err) {
        logger.warn(`Steam Store view failed for ${appid}:`, err);
```

**Edit 6 of 7.** Before:

```ts
    retryAt.delete(appid);
    artRetried.delete(appid);
    matched.delete(appid);
}

/**
```

After:

```ts
    retryAt.delete(appid);
    artRetried.delete(appid);
    matched.delete(appid);
    setNativeAppid(appid, undefined);
    setNativeActivitySource(appid, undefined);
    setExtraSections(appid, undefined);
}

/**
```

**Edit 7 of 7.** Before:

```ts
            logger.warn(`Could not clear art slot ${slot} for ${appid}:`, err);
        }
    }
    revertGameDetails(appid);
    forget(appid);
    return res;
```

After:

```ts
            logger.warn(`Could not clear art slot ${slot} for ${appid}:`, err);
        }
    }
    if (slotList(res.slots).includes(2)) await clearLogoPosition(appid);
    revertGameDetails(appid);
    forget(appid);
    return res;
```

Check: `git hash-object steam-cartridges/frontend/features/steam-store/index.ts` prints `72ce4a30605702f04d6c2277a906c5871583217d`.

### Step 28: `scratch/check_parity.mjs` (new file) — the gate script (spec in § 6)

Create with exactly:

```js
// Parity gate (docs/plans/steam-cartridges-parity.md § 5): compares a non-Steam
// shortcut with the Steam data Steam itself holds for its native app, surface by
// surface, and prints PASS/FAIL per line. Read-only: it navigates the desktop
// client (A -> B -> A, Routine 2) and reads Steam's stores; it never writes
// settings, the library, collections or artwork.
//
//   node scratch/check_parity.mjs [shortcutAppid] [nativeAppid] [otherNativeAppid]
//
// Defaults: Jotunnslayer shortcut 2315502503, native 2820820, B = 435150.
// Needs Steam started with DevTools on 127.0.0.1:8080, desktop UI.
// Exit code 0 only when every line is PASS (the P5 gate).
import { existsSync } from 'node:fs';

const PORT = process.env.CDP_PORT ?? '8080';
const S = Number(process.argv[2] ?? 2315502503);
const N = Number(process.argv[3] ?? 2820820);
const B = Number(process.argv[4] ?? 435150);
const GRID = process.env.SC_GRID ?? 'C:/game/steam/userdata/83513586/config/grid';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(pred, label) {
    const t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(pred);
    if (!t) throw new Error(`No CDP target: ${label}`);
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
    let id = 0;
    const pend = new Map();
    ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        pend.get(m.id)?.(m);
        pend.delete(m.id);
    };
    const ev = (expression) =>
        new Promise((res, rej) => {
            pend.set(++id, (m) =>
                m.result?.exceptionDetails ? rej(new Error(m.result.exceptionDetails.exception?.description)) : res(m.result?.result?.value),
            );
            ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
        });
    return { ev, close: () => ws.close() };
}

const shared = await connect((t) => t.title === 'SharedJSContext', 'SharedJSContext');
const desk = await connect((t) => t.title === 'Steam' && t.url.includes('minwidth=1010'), 'desktop Steam window');
const results = [];
const check = (label, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

const HEADS = String.raw`JSON.stringify([...new Set([...document.querySelectorAll('h2, h3, [class*="SectionTitle"]')].map((e) => e.textContent.trim()).filter(Boolean))])`;
async function open(appid) {
    await shared.ev(`(SteamClient.URL.ExecuteSteamURL('steam://nav/games/details/${appid}'), true)`);
    // Poll the data signal: our sections / Steam's page heading, bounded (guardrail 15).
    for (let i = 0; i < 30; i++) {
        await wait(500);
        const heads = JSON.parse(await desk.ev(HEADS));
        if (heads.includes('Notes')) break;
    }
    await wait(1500);
}

const prev = await shared.ev(`JSON.stringify(window.MainWindowBrowserManager?.m_lastLocation?.pathname ?? null)`);
try {
    // Native data straight from Steam's StoreItemCache (loads unowned apps; P0 T3).
    const native = JSON.parse(
        await shared.ev(`(async () => {
            const c = StoreItemCache;
            const req = { include_assets: true, include_basic_info: true, include_release: true, include_full_description: true };
            if (!c.BHasApp(${N}, req)) c.QueueAppRequest(${N}, req);
            for (let i = 0; i < 30 && !c.BHasApp(${N}, req); i++) await new Promise((r) => setTimeout(r, 500));
            const it = c.GetApp(${N});
            const safe = (f) => { try { return f(); } catch { return null; } };
            return JSON.stringify(it ? {
                short: safe(() => it.GetShortDescription()),
                devs: safe(() => it.GetDeveloperNames()) ?? [],
                pubs: safe(() => it.GetPublisherNames()) ?? [],
                rel: safe(() => it.GetReleaseDateRTime()),
                orig: safe(() => it.GetOriginalReleaseDateRTime()),
                cats: [...(safe(() => it.GetStoreCategories_SupportedPlayers()) ?? []), ...(safe(() => it.GetStoreCategories_Controller()) ?? [])],
            } : null);
        })()`),
    );
    if (!native) throw new Error(`StoreItemCache has no data for ${N}`);

    // Routine 2: A -> B -> A, then read everything on the second visit.
    await open(S);
    await open(B);
    await open(S);
    await wait(3000); // the store handler resolves after the page renders; everything below polls nothing slower

    const plugin = `(PLUGIN_LIST['steam-cartridges-dev'] ?? PLUGIN_LIST['steam-cartridges'])`;
    const st = JSON.parse(
        await shared.ev(`(async () => {
            const P = ${plugin};
            const state = await P.steamStoreState();
            const ad = appDetailsStore.GetAppData(${S});
            const ov = appStore.GetAppOverviewByAppID(${S});
            const diag = P.nativeSectionsDiagnostics?.() ?? null;
            const events = (appid) => {
                const e = appActivityStore.m_mapAppActivity.get(appid);
                const out = [];
                for (const day of e?.m_mapActivityByDay?.values() ?? []) for (const ev of day.m_rgEvents ?? []) out.push(String(ev.unUniqueID ?? ev.m_gidAnnouncement ?? ''));
                return out;
            };
            return JSON.stringify({
                mapping: state.mappings?.['${S}'] ?? null,
                applied: state.applied_artwork?.['${S}'] ?? null,
                snippet: ad?.descriptionsData?.strSnippet ?? '',
                devs: (ad?.associationData?.rgDevelopers ?? []).map((d) => d.strName),
                pubs: (ad?.associationData?.rgPublishers ?? []).map((d) => d.strName),
                rel: ov?.rt_steam_release_date ?? 0,
                orig: ov?.rt_original_release_date ?? 0,
                cats: [...(ov?.m_setStoreCategories ?? [])],
                logoPosition: ad?.customImageInfo?.logoPosition ?? null,
                diag,
                nativeEvents: events(${N}),
                shortcutEvents: events(${S}),
            });
        })()`),
    );
    const heads = JSON.parse(await desk.ev(HEADS));

    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    check(`1. Steam Store match: ${S} -> ${N}`, st.mapping?.steam_appid === N, st.mapping ? `mapped to ${st.mapping.steam_appid}` : 'no mapping');
    check('2. Game Info description = native short description', !!native.short && st.snippet === native.short, st.snippet.slice(0, 50));
    check('3. Developers = native', same(st.devs, native.devs), `${st.devs.join(', ')} vs ${native.devs.join(', ')}`);
    check('4. Publishers = native', same(st.pubs, native.pubs), `${st.pubs.join(', ')} vs ${native.pubs.join(', ')}`);
    check(
        '5. Release dates = native (steam + original)',
        st.rel === native.rel && st.orig === (native.orig || native.rel),
        `${st.rel}/${st.orig} vs ${native.rel}/${native.orig}`,
    );
    const missingCats = native.cats.filter((c) => !st.cats.includes(c));
    check('6. Player + controller categories include every native one', missingCats.length === 0, missingCats.length ? `missing ${missingCats.join(',')}` : st.cats.join(','));
    const d = st.diag;
    check('7. Links use the native app', d?.lastNative?.links === N && d.counts.links > 0, d ? `links ${d.counts.links} -> ${d.lastNative.links}` : 'no nativeSectionsDiagnostics');
    const files = ['p', '_hero', '_logo', ''].map((s) => ['png', 'jpg', 'jpeg'].some((x) => existsSync(`${GRID}/${S}${s}.${x}`)));
    const slots = Array.isArray(st.applied?.slots) ? st.applied.slots : [];
    check(
        '8. Artwork: 4 slots from the match, logo positioned',
        files.every(Boolean) && st.applied?.steam_appid === N && !!st.mapping && [0, 1, 2, 3].every((s) => slots.includes(s)) && !!st.logoPosition,
        `files ${files.map(Number).join('')}, slots ${slots.join(',')}, logoPosition ${st.logoPosition ? 'set' : 'null'}`,
    );
    check('9. Friends section reads the native app', d?.lastNative?.friends === N && d.counts.friends > 0, d ? `friends ${d.counts.friends}` : 'no diagnostics');
    check(
        '10. Community Content section on desktop, native app',
        heads.some((h) => h.startsWith('Community Content')) && d?.lastNative?.community === N,
        heads.filter((h) => /Community/.test(h)).join('|') || 'no Community heading',
    );
    const missingEvents = st.nativeEvents.filter((e) => !st.shortcutEvents.includes(e));
    check(
        '11. Activity feed carries every native news/partner event',
        st.nativeEvents.length > 0 && missingEvents.length === 0,
        `native ${st.nativeEvents.length}, missing ${missingEvents.length}`,
    );
    check('12. Your Stuff media section present', heads.includes('Recordings and Screenshots'));
    check('13. Notes section present', heads.includes('Notes'));
} finally {
    const p = JSON.parse(prev ?? 'null');
    if (p) await shared.ev(`(MILLENNIUM_API.Navigation.Navigate(${JSON.stringify(p)}), true)`).catch(() => {});
    shared.close();
    desk.close();
}
const pass = results.filter(Boolean).length;
console.log(`\n${pass} PASS / ${results.length - pass} FAIL`);
process.exit(pass === results.length ? 0 : 1);
```

Check: `git hash-object scratch/check_parity.mjs` prints `7baf2fc1560097920c1071deb8118844e27d5d7f`.
Do **not** run it (it drives the live client); § 9 runs it.

### Step 29: Parts B–E gate

```bash
cd /c/game/millennium/steam-cartridges && npm run check && npm run test:ts 2>&1 | grep -E "^ℹ (tests|pass|fail)" && npm run build 2>&1 | tail -1
```
Expected: the two `check` banner lines, nothing from `tsc`, then exactly:
```
ℹ tests 42
ℹ pass 42
ℹ fail 0
```
and a last line starting `build Succeeded`. Then:

```bash
cd /c/game/millennium && node --check scratch/check_parity.mjs && echo syntax-ok
```
Expected: `syntax-ok`.

### Step 30: Parts B–E docs

30a. `CHANGELOG.md`: Before:
```
## [Unreleased]

```
After:
```
## [Unreleased]

- **`steam-cartridges` native parity for mapped shortcuts (offline)**: Game Info credits through Steam's accessors, both release dates, category 39 for split-screen co-op; Steam's own Links / Friends / Community sections read the native appid (ADR-0037); the native app's news joins the activity feed; default logo position for the logo we write. Gate script `scratch/check_parity.mjs` (baseline 3 PASS / 10 FAIL). Plan: [docs/plans/steam-cartridges-parity.md § 5](docs/plans/steam-cartridges-parity.md#5-parts-be-close-the-parity-gaps). `tsc` clean, `test:ts` 42/42. Live gate pending.

```

30b. `TASK.md`: Before:
```
    - [ ] B Game Info fields · C Links / Friends / Community sections · D native news in the activity feed · E logo position
    - [ ] `scratch/check_parity.mjs` · offline gates: `tsc`, `test:ts` 42/42
```
After:
```
    - [x] B Game Info fields · C Links / Friends / Community sections · D native news in the activity feed · E logo position
    - [x] `scratch/check_parity.mjs` · offline gates: `tsc`, `test:ts` 42/42
```

### Step 31: Parts B–E commit (do not push unless the caller said so)

```bash
cd /c/game/millennium && git add steam-cartridges/frontend/rpc.ts steam-cartridges/frontend/features/game-info/normalize.ts steam-cartridges/frontend/features/steam-store/store-item.ts steam-cartridges/frontend/features/game-info/metadata.ts steam-cartridges/tests/steam-store.test.ts steam-cartridges/frontend/features/steam-store/native-sections-core.ts steam-cartridges/tests/native-sections.test.ts steam-cartridges/frontend/features/game-info/game-info-patch.ts steam-cartridges/frontend/features/steam-store/native-sections.ts steam-cartridges/frontend/steam/sections.ts steam-cartridges/frontend/index.tsx steam-cartridges/frontend/steam/activity.ts steam-cartridges/frontend/features/steam-store/logo.ts steam-cartridges/frontend/features/steam-store/index.ts scratch/check_parity.mjs TASK.md
git show HEAD:CHANGELOG.md > .git/cl_head.md
python - <<'EOF'
head = open('.git/cl_head.md', encoding='utf-8').read()
new = open('CHANGELOG.md', encoding='utf-8').read().replace('\r\n', '\n')
line = next(l for l in new.split('\n') if l.startswith('- **`steam-cartridges` native parity for mapped shortcuts (offline)**'))
marker = '## [Unreleased]\n\n'
assert head.count(marker) == 1
open('.git/cl_new.md', 'w', encoding='utf-8', newline='\n').write(head.replace(marker, marker + line + '\n\n'))
EOF
git diff --no-index .git/cl_head.md .git/cl_new.md | sed 's#a/.git/cl_head.md#a/CHANGELOG.md#; s#b/.git/cl_new.md#b/CHANGELOG.md#' | git apply --cached
rm -f .git/cl_head.md .git/cl_new.md
git diff --cached --stat
```
Expected: exactly 17 files: the 14 `steam-cartridges/` paths,
`scratch/check_parity.mjs`, `TASK.md`, and `CHANGELOG.md | 2 ++`. Anything else: stop.

```bash
cd /c/game/millennium && git commit -m "feat(steam-cartridges): native parity for mapped shortcuts - Game Info fields, Steam's own links/friends/community, native news, logo position (ADR-0037)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

## 6. Gate script spec (`scratch/check_parity.mjs`)

`node scratch/check_parity.mjs [shortcut=2315502503] [native=2820820] [other=435150]`,
desktop UI, DevTools on `127.0.0.1:8080`. It loads the native store item through
`StoreItemCache` (Steam's transport), does A → B → A on the desktop with
`steam://nav/games/details/<appid>` (Routine 2), reads Steam's stores and the
plugin's read-only exports, prints one `PASS`/`FAIL` line per surface and
`<n> PASS / <m> FAIL`, returns to the page that was open, and exits 0 only when
all 13 pass. It writes nothing. Grid folder: `SC_GRID` (default
`C:/game/steam/userdata/83513586/config/grid`).

| # | Surface | PASS when | Baseline 2026-09-25 |
| --- | --- | --- | --- |
| 1 | Store match | `steamStoreState().mappings[S].steam_appid === N` | FAIL (no mapping) |
| 2 | Description | `descriptionsData.strSnippet === item.GetShortDescription()` | FAIL (Conan DLC text) |
| 3 | Developers | `rgDevelopers` names equal `GetDeveloperNames()` (order too) | FAIL (Games Farm vs Games Farm, ARTillery) |
| 4 | Publishers | `rgPublishers` names equal `GetPublisherNames()` | PASS |
| 5 | Release dates | `rt_steam_release_date === GetReleaseDateRTime()` and `rt_original_release_date === GetOriginalReleaseDateRTime()` (or the steam date when there is none) | FAIL (1775692800 both) |
| 6 | Player + controller categories | every id of `GetStoreCategories_SupportedPlayers()` ∪ `GetStoreCategories_Controller()` is in `m_setStoreCategories` | FAIL (missing 1, 9, 39, 24) |
| 7 | Links | `nativeSectionsDiagnostics().lastNative.links === N`, count > 0 | FAIL (no diagnostics export) |
| 8 | Artwork | the 4 grid files exist, `applied_artwork[S]` is for N with slots 0–3, a mapping exists, `customImageInfo.logoPosition` set | FAIL (logoPosition null, no mapping) |
| 9 | Friends who play | `lastNative.friends === N`, count > 0 (the section may render empty when no friend plays it: that is Steam's answer) | FAIL |
| 10 | Community Content | desktop heading `Community Content…` present and `lastNative.community === N` | FAIL |
| 11 | News / partner events | the native entry has ≥ 1 event and every native event id (`unUniqueID`) is in the shortcut's feed | FAIL (native 1, missing 1) |
| 12 | Your Stuff media | heading `Recordings and Screenshots` | PASS |
| 13 | Notes | heading `Notes` | PASS |

A check changes only when the expected behaviour changes in an accepted ADR
(guardrail 15). If Steam returns zero native events for 2820820 on the day of
the gate, check 11 cannot pass: record the output and ask the architect; do not
loosen it.

## 7. Do not touch

- `steam-cartridges/backend/**` (P4 owns it; Parts A–E are frontend only), `plugin.json`, `dev.ps1`, `package.json`, `package-lock.json`, `tsconfig.json`
- `steam-cartridges/frontend/steam/{summary,stores,jsx-hook,gamepad-appid,headline-patch,activity-cards-patch,route,shortcut,gameid,modules}.ts`, `frontend/renderers/**`
- `steam-cartridges/frontend/settings/settings.ts`, `features/buckets/{collections,ready}.ts`, `features/artwork/**`, `features/steam-store/{known-apps,resolve,enriched,art-plan}.ts`
- Every file not named in a step; `docs/**` (except the Step 12/30 edits to `TASK.md`, `CHANGELOG.md`); `scratch/check_all_tabs.js`, `scratch/test_nav_cycle.js`
- Anything under `C:\game\steam\` (plugins, Millennium config, `library_metadata.json`, `steam_store.json`, userdata, grid)
- The unrelated uncommitted user changes (`enhanced-achievements/`, `enhanced-notifications/`, `scratch/check_toast_metrics.mjs`, `scratch/find_popup_module.mjs`, other `CHANGELOG.md` hunks)

## 8. Banned actions and failure rule

- No deploy or restart: no `dev.ps1`, `start-steam-dev.ps1`, `steam.exe`.
- No SharedJSContext reload, no CDP at all (the gate script is § 9, not yours), no probe or throwaway plugins.
- No edits to Millennium `config.json` or plugin config (`setSetting`, `PluginConfig_*`); do not run `tests/buckets.mjs` (it writes plugin config).
- No changes to the user's library, collections, shortcuts or artwork.
- No `npm install`, `npm update` or version change (ignore the `@steambrew/ttc` update nag).
- No `git add -A` / `git add .`, `git push --force`, `--no-verify`, amend or rebase.
- Do not change any assertion, expected count, hash or gate check to make a step pass.

**Failure rule.** Run any failing command at most **twice**. After the second
failure, stop; do not edit around it or skip ahead. Append to `TASK.md`
§ Active Failures & Blockers:
```
- BLOCKED parity step <N>: `<command>` failed twice:
  <first 30 lines of output>
```
Then commit only `TASK.md` (message `docs(task): parity plan blocked at step <N>`,
with the attribution line) and exit.

## 9. Live verification and exit criteria (the P5 gate)

Not for the implementer. The user deploys (`dev.ps1`, graceful restart). Then,
in order; every item must hold. Record the outputs in `TASK.md` / `CHANGELOG.md`.

1. **Part A, desktop, SharedJSContext:**
   `PLUGIN_LIST['steam-cartridges-dev'].bucketReport().games[2315502503]` is
   `{ bucket: 'steam-store', via: 'default' }`. Open the Jotunnslayer page once; then
   `(await PLUGIN_LIST['steam-cartridges-dev'].steamStoreState()).mappings['2315502503']`
   has `steam_appid: 2820820`, `source: 'search'`. AM2R (4263274102) resolves
   `steam-store` / `default`, has no mapping, and still shows its local Game Info
   (web fallback: `Fetching Game Info & Metadata for: "AM2R"` appears only when Twitch
   credentials exist). A RetroArch shortcut logs no `storesearch` request (emulator guard).
2. **Settings panel** (Millennium → Plugins → steam-cartridges): the Buckets list shows
   "Default (Steam Store, web fallback)" per collection, the two pattern fields appear once a
   collection has a rule, the membership note is shown; the Steam Store list shows
   Jotunnslayer with its match. Change nothing that the user did not ask for.
3. **P4 H2/H3/H6 (user action: take the PC offline).** Open a shortcut never looked up
   before: the log shows `Steam Store search failed for "<title>": offline` within ~8 s; a
   second new shortcut fails at once (breaker). Back online, the first one is looked up on
   a view after 5 minutes.
4. **Parity gate (desktop):** `node scratch/check_parity.mjs` prints `13 PASS / 0 FAIL` and
   exits 0. Run it twice: right after the restart and again after opening two other games.
5. **Big Picture** (`start-steam-dev.ps1 -BigPicture`, not a mode toggle), Jotunnslayer: the
   header draws the logo; GAME INFO shows "Hordes of Hel is a gripping roguelike…",
   "Developer: Games Farm, ARTillery", "Publisher: Grindstone", a 2025 release date, and
   badges Single-Player, Multi-Player, Co-op, Shared/Split Screen, Full Controller Support;
   "Store Page" opens app 2820820; the COMMUNITY tab lists content; ACTIVITY shows the
   partner event. One clipped, low-quality screenshot per claim (guardrail 4).
6. **Regression (Routines 1–3):** `node scratch/test_nav_cycle.js` five times, every line
   `PASS`; in Big Picture `node scratch/check_all_tabs.js`, every line `PASS` (AM2R); AM2R's
   four views by eye.

**Exit criteria = the P5 gate:** items 1–6 all pass on the same deploy. Only
then does TASK.md's parity line get ticked and P5 unblock. P5 scope stays
ADR-0034 (Steam native, RetroAchievements); no user-created achievements.

## 10. Guardrail checklist (re-read each in docs/plugins.md; tick with one line of proof)

- [ ] **1 ID coupling:** the links proxy returns `BIsModOrShortcut` false only with a native appid and passes every other read to the real overview; `GetGameID` hooks untouched.
- [ ] **2 O(1):** the jsx handler is one `Map.get` on the element type and one on the appid; proxies are cached per (object, native).
- [ ] **3 single-pass:** `resolveTypes()` scans `req.m` once, from `installNativeSections()` at startup; never in a render or callback.
- [ ] **4 multi-tab:** § 9 items 5–6.
- [ ] **5 stubs / negative cache:** shortcut stubs untouched; the native app's store item is Steam's own.
- [ ] **6 two-way nav:** the gate script does A → B → A; § 9 item 6.
- [ ] **7 categories:** the purge list is `STEAM_CATEGORIES`, now with 39; nothing outside it is added.
- [ ] **8 details:** no `appData.details` write; the friends proxy only overrides `unAppID` on a proxy.
- [ ] **10 memo:** `setExtraSections` re-renders through `refreshInstances` (memo cleared first).
- [ ] **11 re-render:** `refreshGameInfoInstances()` after the native appid is known; `setExtraSections` re-renders the sections.
- [ ] **13 MobX computed:** no new `collectionStore` read; titles come from `appStore.GetAppOverviewByAppID`.
- [ ] **14 gates:** local Game Info still shows until store data replaces it; unmatched shortcuts lose only dead links (ADR-0037 consequence).
- [ ] **15 checks:** the gate script's 13 checks are fixed by ADR-0037; `check_all_tabs.js` / `test_nav_cycle.js` unchanged.

## 11. Dry-run record

Applied P4 Steps 1–15, then Steps 1–10, 14–27 and 28 of this plan, to
`git archive HEAD steam-cartridges` in a scratch folder (2026-09-25): every
before block matched exactly once and every Check hash matched; Part A gate:
`tsc` clean, `test:ts` 35/35, build succeeded; Parts B–E gate: `tsc` clean,
`test:ts` 42/42, build succeeded; Lua unchanged (71 + 86 PASS). The gate script
ran live (read-only) against the current build: `3 PASS / 10 FAIL`, as in § 6.

Not verified offline (checked by § 9): the partner event rendering inside the
shortcut's feed, the logo position call (`SaveCustomLogoPosition`), and the
three component signatures on the running client.

## 12. Questions for the user

- **Q1.** Native 2820820 lists Steam-service features (Achievements, Steam Cloud,
  Trading Cards, Family Sharing). They are false for an Epic copy, so this plan
  does not copy them (gate check 6 compares player and controller categories
  only); Achievements comes with P5. Keep it that way?
