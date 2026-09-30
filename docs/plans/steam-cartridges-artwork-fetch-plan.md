# Plan: artwork image fetch leaves the surface (one job per layer, for the four art slots and the icon)

**Status:** Draft (2026-09-29). **Not dry-run yet** (§ 9); decisions recorded in § 0: the before blocks were copied from `98397df`, the after blocks and the
expected test counts are derived, not observed. A dry-run in a scratch worktree (as the icon plan's § 9) is the first task of
whoever executes this. Do not hand it to a weak implementer before that.
**Kind:** Architecture cleanup (ADR-0039), no user-visible change.
**Asked for by:** the user, 2026-09-29, after the icon refactor: "keep the architecture clean regarding
`surfaces/artwork/artwork.ts` still has its own `fetchImageAsBase64`, with the same concept" (port fetches, app hands the bytes over,
the surface only writes).
**Layer rules:** [steam-cartridges/README.md § May import / must never import](../steam-cartridges/README.md),
[surfaces.md](../steam-cartridges/surfaces.md). **Related:** [steam-cartridges-icon-plan.md § 11](steam-cartridges-icon-plan.md).

## 0. Decisions (the user, 2026-09-29)

1. **The image bin, not `GameRecord`,** carries the fetched bytes (finding 3). The icon moves into it too. Agreed.
2. **The F1 plan may be edited** to fit this one. So the F1/`SteamStoreDownloadImage` interplay is resolved by editing the F1 plan, not by ordering: whoever executes first, the other plan's before-blocks
   (`tests/test_steam_store.lua`, `frontend/ports/backend.ts` near `steamStoreClearMapping`) are re-copied from the tree at that moment. Before executing this plan, check
   `git grep -n "steam-cartridges-artwork-fetch\|DownloadImage" -- docs/plans/steam-cartridges-f1-game-data-editor*` and update the F1 plan/patches if they touch those lines.
3. **Steps 3-5 are one session and one commit** (`tsc` is red between them by design). Do not stop between them; if § 8 forces a stop, `git stash` is not allowed: `git restore .` and start step 3 again.

## 1. Root cause and what the research found

After the icon refactor the icon path is clean (`ports/image.ts` fetches, `app/artwork.ts` hands the bytes over, the surface
writes). The four art slots still work the old way:

| # | Finding | Evidence | Consequence |
| --- | --- | --- | --- |
| 1 | **Overlap.** `surfaces/artwork/artwork.ts` `fetchImageAsBase64` (lines 21-92) does network I/O, the wsrv.nl retry and the FileReader conversion inside a surface. `ports/image.ts` `fetchImage` does the same for the icon. Two copies of one job, one of them in the wrong layer. | `git grep -n "wsrv.nl" -- frontend` prints both files | One fetch, in `ports/image.ts`; the surface loses `fetchImageAsBase64` and its `fetch` call in `applyCustomArtworkFromUrls` (line 117). |
| 2 | **Latent bug.** When the direct `fetch` of a Steam CDN URL fails, `fetchImageAsBase64` falls back to the backend RPC `SteamStoreDownloadImage`. The backend cannot download an image: Millennium's Lua `http.get` cuts a binary body at its first NUL byte. Live, 2026-09-29: `SteamStoreDownloadImage` for `…/2277560/header.jpg` returned `{"base64":"/9j/4A==","ext":"jpg"}` (4 bytes) for a 25 KB file. The surface would then hand those 4 bytes to `SetCustomArtworkForApp`. | live `Millennium.callServerMethod('steam-cartridges-dev','SteamStoreDownloadImage',…)`; icon plan § 11 | The fallback is removed, and with it the RPC (nothing else calls it, dead-code rule D13): `SteamStoreDownloadImage` in `steam_store_rpc.lua` and `main.lua`, `steamStoreDownloadImage` in `ports/backend.ts`, the `downloadImage` surface dep. |
| 3 | **Size decides the hand-over.** One mapped game's four slots are 26 383 + 371 583 + 161 387 + 25 324 = **584 677 bytes** (≈ 780 KB as base64; WUCHANG's Steam CDN files). The record store keeps every record for the session; 220 shortcuts would hold ≈ 170 MB. The 15 KB icon in `IconPlan.base64` was fine; the slots are not. | `curl -w %{size_download}` on `library_600x900.jpg`, `library_hero.jpg`, `logo.png`, `header.jpg` of app 2277560 | The bytes do **not** go into `GameRecord`. They go into a small in-memory **image bin** (kernel), bounded to the last 8 shortcuts. The icon moves into the same bin so there is one mechanism (`IconPlan.base64`, added by the icon refactor, is removed again). |
| 4 | A render can run twice for one plan (a record update re-renders; the render queue can replay). A bin the surface emptied on read would make the second run see no bytes, write nothing and record every slot as failed. | `app/render-queue.ts`, `surfaces/artwork/index.ts` `render` (no de-duplication) | `take` is **non-destructive**; the bin evicts the oldest shortcut beyond 8. A slot whose bytes are missing is simply not written, which the surface already reports as `failed` (retried once per session, P4 H5). |

Layer split after this plan (same as the icon):

| Layer | Job |
| --- | --- |
| `kernel/image-bin.ts` (new) | A bounded in-memory map `appid -> { portrait?, hero?, logo?, wide?, icon? }` of `{ base64, ext }`. Pure, imports nothing. |
| `ports/image.ts` | The only image fetch. Gains `forcePng` (the logo slot is always saved as PNG). |
| `app/artwork.ts` | Fetches the bytes of the slots in `plan.write` and of the icon, **puts them in the bin before** `records.update` triggers the render. A slot that fails to fetch is left out of the bin. |
| `surfaces/artwork` | Reads the bin and writes to Steam. No `fetch`, no `FileReader`, no backend download. |

Data flow:

```
app/artwork.resolve ── ensureFresh ──► plan (urls, write, icon:{url})        (unchanged, no bytes)
      │ for each slot in plan.write with a url, and the icon: ports/image.fetchImage(url, forcePng)
      ▼ images.discard(appid); images.put(appid, key, image)                  (BEFORE records.update)
      records.update(appid, { artwork })  ──► surface render(appid, record)
surfaces/artwork.execute: images = deps.images.get(appid)
      slots: SetCustomArtworkForApp(appid, images[key].base64, images[key].ext, slot)  → written[]
      icon:  saveIcon(appid, plan.icon.url, source, steamAppid, images.icon.base64) → SetShortcutIcon
```

## 2. Preconditions

Run from `c:\game\millennium\steam-cartridges` in PowerShell. Every line must hold before step 1.

| # | Command | Expected |
| --- | --- | --- |
| P1 | `git status --short -- .` | prints nothing |
| P2 | `git log -1 --format=%h` | `98397df` or a descendant that still contains `frontend/ports/image.ts` (`Test-Path frontend/ports/image.ts` prints `True`) |
| P3 | `npm run check` | after the npm banner and `> tsc --noEmit`: nothing; exit 0 |
| P4 | `npm run test:ts` | ends `ℹ pass 160` and `ℹ fail 0` (with F1 committed: 177) |
| P5 | the Lua block below | `test_steam_store: 84` (with F1: 91), `test_art_service: 59`, `test_backend: 78`; each last line `ALL PASS` |
| P6 | `npm run build` | contains `build Succeeded passing all tests` (a `TS5096` warning is known) |
| P7 | `git grep -n "fetchImageAsBase64\|downloadImage\|SteamStoreDownloadImage" -- frontend backend tests` | exactly the lines this plan edits: `frontend/surfaces/artwork/{artwork,deps,index}.ts`, `frontend/index.tsx`, `frontend/ports/backend.ts`, `backend/{main,steam_store_rpc}.lua`, `tests/test_steam_store.lua` |

```powershell
$env:NSGA_STEAM_ROOT = 'C:/game/steam'
foreach ($t in 'test_steam_store','test_art_service','test_backend') {
  $o = lua "tests/$t.lua" 2>&1
  '{0}: {1} PASS, last line: {2}' -f $t, ($o | Select-String '  PASS').Count, ($o | Select-Object -Last 1)
}
```

If P1-P7 do not hold, stop (failure rule, § 8).

## 3. Do-not-touch list

- `frontend/kernel/record.ts` `ArtworkPlan` (the plan carries no bytes), except the one type edit in step 3 (`IconPlan`).
- `frontend/domain/art-plan.ts` (`iconPlan` still returns `{ url }`; the `base64` is not its business).
- `frontend/settings/**`, `tests/fixtures/settings-defaults.json`, `tests/architecture-allowlist.json` (must not change).
- `frontend/surfaces/` other than `surfaces/artwork/`; `frontend/sensors/`, `frontend/safety/`, `frontend/steam/`.
- `backend/art_service.lua`, `backend/shortcut_icon.lua` (its `save(appid, url, base64)` already takes the bytes), `backend/web_sgdb.lua`.
- `SteamStoreSaveIcon`, `SteamStoreRecordIcon`, `SteamStoreRecordArtwork` and their ports.
- Every existing check in `tests/live/` (guardrail 15).

## 4. Banned actions

No deploy or Steam restart (`dev.ps1`, `start-steam-dev.ps1`); no SharedJSContext reload; no probe or throwaway plugins; no running
anything under `tests/live/` (it changes the user's library); no edits to Millennium's `config.json` or the plugin's config; no changes to
the user's library, collections or shortcuts; no `npm install` / upgrade; no `git push --force`; no `--no-verify`; no editing a "before"
block "to make it fit" (a mismatch means the plan is stale: stop).

## 5. Steps

Each step: make the edit with the Edit tool (the "before" text must match exactly once), then run the command and compare.
Line endings are LF (`git ls-files --eol`); `tests/*.ts` written with PowerShell must be re-checked with `git ls-files --eol` (icon plan § 11).

### Step 1: the image bin (kernel)

Create `frontend/kernel/image-bin.ts`:

```ts
// Kernel: the image bytes app/ fetched for a shortcut, waiting for the artwork surface to write them
// (artwork fetch plan). Kept out of GameRecord on purpose: one mapped game's four slots are ~585 KB,
// so the record store (which keeps every record for the session) would hold ~170 MB. Bounded to the
// last MAX_APPIDS shortcuts; reads do not remove, because a render can run twice for one plan.

export type ImageKey = 'portrait' | 'hero' | 'logo' | 'wide' | 'icon';
export interface BinImage {
    base64: string;
    ext: string;
}
export type BinImages = Partial<Record<ImageKey, BinImage>>;

export interface ImageBin {
    /** Forget this shortcut's images (a new plan starts from nothing). */
    discard(appid: number): void;
    put(appid: number, key: ImageKey, image: BinImage): void;
    /** What was put for this shortcut, `{}` when nothing (or evicted). Does not remove it. */
    get(appid: number): BinImages;
}

export const MAX_APPIDS = 8;

export function createImageBin(): ImageBin {
    const map = new Map<number, BinImages>();
    return {
        discard: (appid) => void map.delete(appid),
        put(appid, key, image) {
            const entry = map.get(appid) ?? {};
            entry[key] = image;
            map.delete(appid); // re-insert: the map's order is the recency order
            map.set(appid, entry);
            while (map.size > MAX_APPIDS) map.delete(map.keys().next().value as number);
        },
        get: (appid) => map.get(appid) ?? {},
    };
}
```

Create `tests/image-bin.test.ts` (3 tests): `put` then `get` returns the image and `get` twice returns it twice; `discard` empties one appid
and leaves the others; putting for `MAX_APPIDS + 1` appids evicts the first one only. Imports carry `.ts`
(`import { createImageBin, MAX_APPIDS } from '../frontend/kernel/image-bin.ts';`).

Expected: `npm run check` prints nothing; `npm run test:ts` ends `ℹ pass 163` and `ℹ fail 0`.
Commit: `git add frontend/kernel/image-bin.ts tests/image-bin.test.ts`, `git commit -m "feat(steam-cartridges): kernel image bin"` + attribution line.

### Step 2: the port learns `forcePng`

`frontend/ports/image.ts`. Before:

```ts
export async function fetchImage(url: string): Promise<{ base64: string; ext: string } | null> {
```

After:

```ts
export async function fetchImage(url: string, forcePng = false): Promise<{ base64: string; ext: string } | null> {
```

Before:

```ts
    if (!blob && url.includes('steamgriddb.com')) blob = await attempt('https://wsrv.nl/?url=' + url.replace(/^https?:\/\//, ''));
```

After:

```ts
    if (!blob && url.includes('steamgriddb.com')) blob = await attempt('https://wsrv.nl/?url=' + url.replace(/^https?:\/\//, '') + (forcePng ? '&output=png' : ''));
```

Before:

```ts
    const lower = url.toLowerCase();
    const ext = found.type
```

After:

```ts
    if (forcePng) return { base64, ext: 'png' };
    const lower = url.toLowerCase();
    const ext = found.type
```

(This reproduces the old `fetchImageAsBase64(url, forcePng)` exactly: the logo is fetched through wsrv with `&output=png` and saved as png.)
Expected: `npm run check` prints nothing; `npm run test:ts` `ℹ pass 163`, `ℹ fail 0` (no test: the port needs `fetch`/`FileReader`, covered live in § 7).
Commit: `git add frontend/ports/image.ts`, `git commit -m "refactor(steam-cartridges): ports/image forcePng"` + attribution line.

### Step 3: app fetches the bytes into the bin (and the icon leaves the record)

`frontend/kernel/record.ts`. Before:

```ts
export type IconPlan = { url: string; base64?: string } | { restore: string };
```

After:

```ts
export type IconPlan = { url: string } | { restore: string };
```

and in the comment above it, replace ` (`base64` = the image bytes app/artwork fetched, so no surface does network I/O)` with nothing (the bytes now
wait in the image bin, kernel/image-bin.ts).

`frontend/app/artwork.ts`. Add to the imports, after `import type { backend as Backend } from "../ports/backend";`:

```ts
import type { ImageBin, ImageKey } from "../kernel/image-bin";
```

In `ArtworkDeps`, before:

```ts
    fetchImage(url: string): Promise<{ base64: string; ext: string } | null>;
```

After:

```ts
    fetchImage(url: string, forcePng?: boolean): Promise<{ base64: string; ext: string } | null>;
    /** Where the fetched bytes wait for the artwork surface (kernel/image-bin). */
    images: ImageBin;
```

In `resolve`, before:

```ts
            const plan = buildPlan(raw.data, deps.now());
            if (plan.icon && "url" in plan.icon) {
                const image = await deps.fetchImage(plan.icon.url);
                if (image) plan.icon = { url: plan.icon.url, base64: image.base64 };
                else {
                    delete plan.icon;
                    logger.warn(`Artwork ${appid}: library icon not fetched`);
                }
            }
```

After:

```ts
            const plan = buildPlan(raw.data, deps.now());
            await fetchImages(appid, plan);
```

and add above `export function createArtwork`:

```ts
const SLOT_KEYS: Record<number, ImageKey> = { 0: "portrait", 1: "hero", 2: "logo", 3: "wide" };
```

and inside `createArtwork`, above `async function resolve`:

```ts
    /** Fetch what the plan will write (its slots and its icon) into the bin, all at once, before the record is updated. */
    async function fetchImages(appid: ShortcutId, plan: ArtworkPlan): Promise<void> {
        deps.images.discard(appid);
        const jobs: Promise<void>[] = plan.write.map(async (slot) => {
            const key = SLOT_KEYS[slot];
            const url = key ? plan.urls[key as keyof ArtworkUrls] : undefined;
            if (!key || !url) return;
            const image = await deps.fetchImage(url, slot === 2).catch(() => null);
            if (image) deps.images.put(appid, key, image);
            else logger.warn(`Artwork ${appid}: ${key} image not fetched`);
        });
        if (plan.icon && "url" in plan.icon) {
            const url = plan.icon.url;
            jobs.push(
                deps.fetchImage(url).catch(() => null).then((image) => {
                    if (image) deps.images.put(appid, "icon", image);
                    else {
                        delete plan.icon;
                        logger.warn(`Artwork ${appid}: library icon not fetched`);
                    }
                }),
            );
        }
        await Promise.all(jobs);
    }
```

`tests/app-artwork.test.ts`: the `setup` helper gets `images: createImageBin()` (import from `../frontend/kernel/image-bin.ts`; return `images`
from `setup`), and the icon test at its end changes from `part.data.icon` deep-equal `{ url: 'i', base64: 'QUJD' }` to `{ url: 'i' }` plus
`images.get(SC).icon` deep-equal `{ base64: 'QUJD', ext: 'jpg' }`. Add 2 tests: (a) a plan writing slots 0 and 2 puts `portrait` and
`logo` in the bin, `fetchImage` is called with `forcePng` true for the logo only; (b) a failed fetch of one slot leaves it out of the bin while
`plan.write` still lists it (so the surface reports it `failed`), and the bin is discarded first (a second `ensure` after `invalidate` does not keep the
old bytes).

Expected: `npm run check` prints an error in `frontend/index.tsx` and `frontend/surfaces/artwork/icon.ts` only (steps 4-5 fix them); therefore run
the tests after step 5. **Do not commit here: steps 3-5 are one commit, made at step 5 (§ 0 decision 3).

### Step 4: the surface reads the bin and writes; it fetches nothing

`frontend/surfaces/artwork/artwork.ts`: delete `fetchImageAsBase64` (the whole block from `/**\n * Fetch an image URL and return as base64 and extension.`
through its closing `}` before `/** Returns the slots that were actually written`), and change `applyCustomArtworkFromUrls`. Before:

```ts
export async function applyCustomArtworkFromUrls(
    appid: number,
    urls: ArtworkUrls,
): Promise<number[]> {
```

After (the function is renamed: nothing is fetched from a URL any more):

```ts
export async function applyCustomArtwork(
    appid: number,
    slots: readonly number[],
    images: BinImages,
): Promise<number[]> {
```

Delete the `tasks` array and the `downloaded = await Promise.all(...)` block (from `const tasks:` through the closing `);` of the `Promise.all`), and
replace the loop head. Before:

```ts
    const appliedSlots: number[] = [];
    for (const item of downloaded) {
        if (!item) continue;
        const { asset, slot, label } = item;
```

After:

```ts
    const appliedSlots: number[] = [];
    for (const slot of slots) {
        const label = SLOT_LABEL[slot];
        const asset = label ? images[label] : undefined;
        if (!label || !asset) continue; // not fetched: reported as failed, retried once per session
```

Add `const SLOT_LABEL: Record<number, "portrait" | "hero" | "logo" | "wide"> = { 0: "portrait", 1: "hero", 2: "logo", 3: "wide" };` under
`ARTWORK_TYPES`, and the imports: `import type { BinImages } from "../../kernel/image-bin";` and drop the `ArtworkUrls` import if `tsc` reports it unused.

`frontend/surfaces/artwork/deps.ts`: delete the `downloadImage` member and its default (`downloadImage: async () => undefined,`); add
`images: ImageBin` (type-only import from `../../kernel/image-bin`) with the default `images: { discard() {}, put() {}, get: () => ({}) }`.

`frontend/surfaces/artwork/index.ts`. Before:

```ts
        written = await applyCustomArtworkFromUrls(appid, plan.urls);
```

After:

```ts
        written = await applyCustomArtwork(appid, plan.write, deps.images.get(appid));
```

(and the import `applyCustomArtwork`), delete `deps.downloadImage = d.downloadImage;`, add `deps.images = d.images;`, and change the `Pick<typeof deps, "downloadImage" | …>` to
`Pick<typeof deps, "images" | "recordArtwork" | "saveIcon" | "recordIcon">`. In the icon call, before:

```ts
    if (plan.icon) await applyIcon(appid, plan.icon, plan.source === "steamgriddb" ? "steamgriddb" : "steam-cdn", plan.steamAppid);
```

After:

```ts
    if (plan.icon) await applyIcon(appid, plan.icon, deps.images.get(appid).icon?.base64, plan.source === "steamgriddb" ? "steamgriddb" : "steam-cdn", plan.steamAppid);
```

`frontend/surfaces/artwork/icon.ts`: `applyIcon(appid, plan, base64, source, steamAppid?)` gains the `base64: string | undefined` argument; the
`if (!plan.base64) return;` and the `plan.base64` in `saveIcon(...)` become `base64`. `tests/artwork-icon.test.ts`: `IMG` becomes
`{ url: '…/i_full.jpg' }`, a `B64 = '/9j/4AAQ'` constant is passed as the third argument of every `applyIcon` call except the restore ones (which
pass `undefined`), and the last test ("a plan without the fetched bytes stores nothing") passes `undefined`.

### Step 5: composition root

`frontend/index.tsx`. Add `import { createImageBin } from "./kernel/image-bin";` next to the other kernel imports, and above `const artwork = createArtwork({`:

```ts
/** The fetched art waiting for the artwork surface (kernel/image-bin): app/artwork puts, surfaces/artwork reads. */
const images = createImageBin();
```

In `createArtwork({ … fetchImage, allowSgdb …})` add `images,` after `fetchImage,`. In `createArtworkSurface({ ...surfaceDeps,`: before

```ts
            downloadImage: (url) => backend.steamStoreDownloadImage(url),
```

After:

```ts
            images,
```

Expected: `npm run check` prints nothing; `npm run test:ts` ends `ℹ pass 165` and `ℹ fail 0` (163 + 2 app tests; the icon test keeps its count);
`npm run build` contains `build Succeeded passing all tests`; the architecture test passes with `tests/architecture-allowlist.json` untouched
(`app -> kernel`, `surfaces -> kernel`, `index -> ports` are already allowed).
Commit steps 3-5: `git add frontend tests/app-artwork.test.ts tests/artwork-icon.test.ts`,
`git commit -m "refactor(steam-cartridges): artwork fetch moves to app + ports/image, the surface reads the image bin"` + attribution line.

### Step 6: the backend download RPC goes away (dead code, finding 2)

`backend/steam_store_rpc.lua`: delete from `--- Fallback only: the frontend fetches CDN art itself (P0 T2).` through the `end)` that closes
`RPC.SteamStoreDownloadImage`, and the blank line after it. `backend/main.lua`: delete the line `SteamStoreDownloadImage  = STORE_RPC.SteamStoreDownloadImage`.
`frontend/ports/backend.ts`: delete the `steamStoreDownloadImage(url: string) { … },` member (3 lines). `tests/test_steam_store.lua`: in the
`check("all eight RPCs exist"` list remove `, "SteamStoreDownloadImage"` and rename the check to `"all seven RPCs exist"`; delete the two lines
`out = json.decode(RPC.SteamStoreDownloadImage(…))` and `check("DownloadImage enforces the allowlist", …)`. (If `utils` is no longer used in
`steam_store_rpc.lua`, `git grep -n "utils\." -- backend/steam_store_rpc.lua` shows it; leave the `require` alone unless the grep is empty, then delete it.)

Expected: the Lua block from § 2: `test_steam_store: 82` (with F1: 89), `test_art_service: 59`, `test_backend: 78`, each `ALL PASS`; `npm run check` nothing;
`npm run test:ts` `ℹ pass 165`; `npm run build` succeeds (the architecture test's RPC-registration check confirms `ports/backend.ts` calls only registered methods).
Commit: `git add backend frontend/ports tests/test_steam_store.lua`, `git commit -m "refactor(steam-cartridges): remove SteamStoreDownloadImage (the backend cannot download a binary body)"` + attribution line.

### Step 7: docs (from `c:\game\millennium`)

With the Edit tool: [surfaces.md](../steam-cartridges/surfaces.md) (artwork section: the surface reads `deps.images`, never fetches; the deps sentence loses `downloadImage`,
gains `images`), [rpc.md](../steam-cartridges/rpc.md) (delete the `SteamStoreDownloadImage` row, line 51; the counts of live RPCs drop by one), [README.md](../steam-cartridges/README.md)
(layer table: Kernel row adds "image bin"), [service-artwork.md](../steam-cartridges/service-artwork.md) (no backend image fetch; `base64` comes from the bin via the surface),
[kernel.md](../steam-cartridges/kernel.md) (`image-bin.ts`: contract, bound of 8, why it is not in `GameRecord`), the icon plan § 11 (one line: superseded by this plan for where the bytes wait), and
[CHANGELOG.md](../../CHANGELOG.md) (new first bullet: what moved, the finding-2 bug, tests). Replace the TASK.md line about this plan with nothing (it is not listed there until executed).
Commit: `git add docs CHANGELOG.md TASK.md`, `git commit -m "docs: artwork fetch plan"` + attribution line. Do not push before § 7 has run.

## 6. Guardrail checklist

`BASE` is the commit before step 1.

- [ ] **1 (BIsModOrShortcut):** untouched. Proof: `git diff BASE -- frontend | Select-String "BIsModOrShortcut|prototype"` prints nothing.
- [ ] **2 (no expensive work in hot hooks):** no hook added; the fetch is in `resolve`, once per shortcut per session. Proof: `git diff BASE --stat -- frontend/steam frontend/sensors` prints nothing.
- [ ] **14 (a new gate never removes working behaviour):** a slot whose fetch fails is still reported `failed` and retried once (`mergeArtResult` unchanged). Proof: `git diff BASE -- tests/app-artwork.test.ts | Select-String "^-[^-]"` shows only the icon test's changed assertion.
- [ ] **15 (never weaken a check):** Proof: `git diff BASE --stat -- tests/live` prints nothing; the only removed test lines are the `DownloadImage` check of the RPC that no longer exists (step 6) and the count in "all eight RPCs".
- [ ] **17 (a render never starts work):** the fetch happens in `resolve` (once per shortcut per session, existing test "one backend call per shortcut per session"), never in `render`. Proof: `git grep -n "fetch(" -- frontend/surfaces` prints nothing.
- [ ] **Disjoint touches:** the `touches` list of `surfaces/artwork/index.ts` is unchanged. Proof: `git diff BASE -- frontend/surfaces/artwork/index.ts | Select-String "touches"` prints nothing.
- [ ] **ADR-0039:** only surfaces write to Steam; no surface does network I/O. Proof: `git grep -n "FileReader\|wsrv" -- frontend` prints only `frontend/ports/image.ts`.

## 7. Live verification (the user, or a verifier the user names)

After `powershell -ExecutionPolicy Bypass -File dev.ps1`, switch to the desktop UI (`SteamClient.UI.SetUIMode(7)`; Steam restarts into Big Picture), from `steam-cartridges`:

1. `npm run test:live`: every line `PASS`, including `PASS  8. Artwork: 4 slots from the match, logo positioned` (inside parity) and `PASS render loop:`.
2. Slots come from the bin: clear WUCHANG and re-link (icon plan § 7 items 6-7 commands). Then `node tests/live/probes/shortcut_icon.mjs 3135033888` prints `PASS icon sharp …` **and**
   `steam_store.json` `applied_artwork["3135033888"].slots` is `[0,1,2,3]` with `failed` `{}`, and the four files exist in `C:\game\steam\userdata\83513586\config\grid\` (`<appid>p.*`, `<appid>_hero.*`, `<appid>_logo.png`, `<appid>.*`).
3. An SteamGridDB shortcut (no Steam match, an empty slot: clear one of AM2R's files by hand only if the user agrees) gets exactly that slot back through the wsrv.nl retry (`&output=png` for the logo).
4. Backend log has no `SteamStoreDownloadImage` call; `node tests/live/probes/http_calls.mjs` shows no new source.

Only after 1-2 pass: replace "Draft" and add the live results to the CHANGELOG entry.

## 8. Failure rule

Run a failing command at most twice. On the second failure stop: append the command, its output (trimmed to 30 lines) and the step number to
[TASK.md](../../TASK.md) § Active Failures & Blockers, then exit. Do not retry, edit a block, edit around the failure or skip ahead.

## 9. Dry-run record

**Not done.** What was checked when writing: the before blocks and line numbers were read from `98397df`; the live measurements of finding 2 (4-byte body) and finding 3
(the four file sizes) were taken on 2026-09-29. What must be done before execution: apply the steps in a scratch worktree of `98397df`, replace the derived expected counts
(163, 165, `test_steam_store` 82) with the observed ones, and update the F1 plan first (§ 0 decision 2; its patches edit `tests/test_steam_store.lua` and `ports/backend.ts` near `steamStoreClearMapping`;
step 6 edits other lines of both, but that is unverified).

## 10. Not in this plan (follow-ups)

- Streaming very large art: the bin is bounded by count (8), not bytes; a hero of several MB would hold that much per entry. Measure before adding a byte cap.
- Moving the SteamGridDB search/fetch of URLs (`web_sgdb`) behind a port: it already lives in the backend service (`art_service`), which is the right layer.
