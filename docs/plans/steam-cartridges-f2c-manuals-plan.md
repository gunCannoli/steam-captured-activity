# Plan (skeleton): F2c ScreenScraper manuals as the first card of the Community section

**Status:** Skeleton, **not ready to execute.** It records the idea, the design the research so far points to, the layer
split, the open questions (each with the cheap probe that answers it) and the order of work. Before any code it must be
turned into a full plan per [the plan writing standard](README.md) (literal before/after blocks, exact commands and
expected output, dry run). Written 2026-09-30, after F2 shipped
([steam-cartridges-f2-community-media-plan.md](steam-cartridges-f2-community-media-plan.md), ADR-0046).
**Parent:** [F2 plan § 12](steam-cartridges-f2-community-media-plan.md#12-not-in-this-plan-follow-ups) (F2c: links and manuals).
**Layer rules:** [steam-cartridges.md § 4](../steam-cartridges.md#4-adding-a-feature), ADR-0039, ADR-0044, ADR-0046.
**Needs:** a new ADR (ADR-0047 if the achievements and F2 numbering is unchanged) when the design is chosen.

## 1. What the user wants

A game's ScreenScraper **manual** (PDF) shows as the **top element, on the first row** of the Community section (desktop and
Big Picture). The user can **open it and scroll through it**, on a controller too. Same rules as the rest of F2: Steam's own
cards and viewer as far as possible, nothing written to disk, the ScreenScraper URL (it carries the accounts) never leaves the
backend, a failure drops the card and nothing else (ADR-0014).

## 2. What is known (verified live 2026-09-30) and what is not

| # | Fact | Source | Consequence |
| --- | --- | --- | --- |
| 1 | A ScreenScraper media is `{ type, region, url, ... }` in `jeu.medias`. Our keys are `type(region)`; `GetMediaImage` answers `unknown key` for a key the game does not have and `not an image` for one whose bytes are not an image (videos `video()`, `video-normalized()`, the HyperSpin theme `themehs()` answer that on the two test games). | probe of `GetMediaImage` on AM2R and Super Mario World | A key's existence can be probed read-only. |
| 2 | **Neither test game has a manual** (`manuel(<region>)` and `manuel()` for 18 regions: all `unknown key`). The manual type name and its region/language form are **not confirmed**. | same probe | Open question Q1: find a game that has one (the ScreenScraper "Manuals" tab) and read its media record. |
| 3 | Steam's image viewer is module `94715` (`N({ strURL, strTitle, children, appid, file_details })`). Its container (`ArtworkModalContainer`) handles **D-pad up/down by `scrollBy({ top: ±100 })`**, and `children` render in a scrolling area under the Close button with a "Scroll down for more" hint. | module source; [ADR-0046 amendment](../decisions.md) | A tall stack of page images given as `children` scrolls with the controller for free. |
| 4 | `surfaces/community` already recognises our viewer (`viewerMeta` by the image URL a card opens) and wraps it (`replaceType` on the viewer component: creator, no thread, height cap). | `surfaces/community/index.ts` | The manual viewer is one more branch of that wrapper, not a new hook. |
| 5 | Steam's grid places cards by size: a card's `image_width` x `image_height` picks a row template (`me(width)` in module `77163`; sizes `Small`, `Medium`, `Large`, `VideoAspect`, `Panoramic`, `Wide`, `Narrow`, `Tall`); a card that fits no row is dropped. | module `77163`; the "No match for item ... deleting row" log lines | Q3: which image size gives **one card across a whole first row**. |
| 6 | The backend downloads one image into memory (`net.get_binary` -> `bin_http.lua`, WinINet, 8 MB cap, 15 s timeouts) and answers base64. A PDF manual can be larger than 8 MB. | `backend/bin_http.lua` | Q5: the cap, a progress/cancel story, and base64 over the RPC for tens of MB. |
| 7 | The settings keys `communityShowManuals` and `communityShowExternalLinks` exist (defaults kept, no row since F2). | `frontend/settings/defaults.ts` | The toggle for this feature already exists; its row is added here. |
| 8 | Steam's card types are Artwork (3), Video (4), Screenshot (5) and Guide (9, 10: opens a Community page by id). | module `44846` | A manual is an **Artwork card** (3) with a generated cover; a Guide card is ruled out (its click opens a Valve page). |

## 3. The design the research points to (to be confirmed by section 5's probes)

**The card.** An item `{ kind: "manual", source: "screenscraper", key: "manuel(<region>)", title: "Manual (<lang>)" }`. No
bytes are fetched to show the card: its cover is a **generated inline image** (an SVG data URI, like the author icons: a
book glyph and the word "Manual", in the first-row size of Q3). `domain/community-media.visibleMedia` ranks it **before
everything** (before trailers), so it is the first card, and `toFeedItems` gives it a distinct size so the first row is its own.

**Opening it.** A click opens Steam's own image viewer on the cover (already how our images work). The viewer wrapper sees
`viewerMeta.kind === "manual"` and renders Steam's viewer with `children` = a **page stack** (our component): one `<img>` per
page, in a column, each a `blob:` URL of a rendered page, plus the page count. Because the viewer container scrolls on the
D-pad, scrolling a manual on a controller costs nothing extra; on desktop the mouse wheel scrolls the same container.

**Rendering the pages (the one real decision; options):**

| Option | How | For | Against / unknown |
| --- | --- | --- | --- |
| **A. pdf.js in the frontend (recommended to try first)** | the backend sends the PDF bytes (base64); the frontend renders each page to a canvas -> `toBlob` -> `blob:` URL, lazily (the next few pages ahead of the scroll) | works on any machine; pages are plain images the viewer already scrolls; memory bounded by a page cache | adds a library (a build dependency the implementer may not add: needs the user's approval, `npm install` is banned in plans) and a web worker (CSP of `steamloopback.host`: Q4); a 40 MB PDF is a heavy base64 over the RPC |
| B. Chromium's PDF viewer | an `<embed type="application/pdf">` / `<iframe>` on the `blob:` PDF inside the viewer | no library; real PDF features | Steam's CEF may ship without the PDF plugin (Q4); the iframe swallows the D-pad, so no controller scrolling; focus and fullscreen traps |
| C. Link out | open the PDF in the system browser | trivial | the URL carries the accounts: it cannot leave the backend; a temp file on disk is against the rule |

**Where each piece lives** (ADR-0039 / ADR-0044): *backend:* `screenscraper_media.media_items` adds the manual type and
language (keys only); `media_service.pdf(appid, key)` downloads the PDF into memory (cap raised for this call, size and
timeout stated), `GetMediaPdf` RPC (new, listed in `rpc.md`); *kernel:* `MediaItem.kind` gains `"manual"`, `media-bin`
gains a page bin; *domain:* `visibleMedia` rank, the toggle `communityShowManuals`; *app:* `app/manuals.ts` (`createManuals`:
`open(appid, key)` fetches the PDF once, renders pages through an injected `renderer` port, fills the page bin; never
touches Steam); *ports:* a `pdf` port (the renderer; the only code that may use pdf.js or `canvas`); *surface:*
`surfaces/community` (the viewer branch reads the page bin through an injected `pagesOf(appid, key)` and asks
`app/manuals.open` from an **effect** in our page-stack component, never from a render, guardrail 17); *settings:* a row
for `communityShowManuals`.

## 4. Questions to answer first (each with its cheapest probe)

| Q | Question | Probe (read-only unless stated) |
| --- | --- | --- |
| Q1 | What is the manual's media type name, its region/language form, its size and format (`pdf`?) in `jeu.medias`? Which of the user's games have one? | Pick a game whose ScreenScraper page has a manual; add the credential-free `GetDiagnostics.ss_search`-style trace of **media types, regions, `format`, `size`** (no URLs) and read it once. |
| Q2 | How big are manuals (pages, MB)? | Same trace plus one in-memory download through `bin_http` (the existing `GetMediaImage` path with the cap raised in a test build, size printed, nothing displayed). |
| Q3 | Which cover size takes a whole first row, and on which UI (desktop width vs Big Picture width)? | Read module `77163`'s row templates (`me()`, the `eSize` table) in the live client and try 3 candidate sizes on a test card; count cards per row in both UIs. |
| Q4 | Can the frontend run pdf.js (worker, `blob:` PDF, canvas) in `SharedJSContext`? Does Steam's CEF have a PDF plugin? | In CDP: `navigator.plugins`/`mimeTypes` for `application/pdf`; `new Worker(blobUrl)`; a `fetch('data:application/pdf;base64,...')` into an `<iframe>`; read the CSP from the response headers of `steamloopback.host`. |
| Q5 | How does a 10-40 MB PDF cross the RPC (base64 of 30 MB is 40 MB in one string)? | Measure `Millennium.callServerMethod` with a large answer; otherwise chunk it (`GetMediaPdfChunk(offset)`), the frontend reassembling. |
| Q6 | Which language? | A manual exists per language; prefer Steam's UI language (`SteamClient.Settings` language), then English, then the first. Read how the existing code picks the UI language. |
| Q7 | Does the first-row card survive Steam's layout when the feed also has 20+ cards? | Live, on a game with a manual and a large IGDB set. |

## 5. Ordered work (each step is its own commit; the first three decide the design, then a full plan is written)

1. **Probe Q1-Q2** on a game that has a manual. Output: the type name, the region/language form, the size, the bytes.
2. **Probe Q3-Q4** in the live client. Output: the cover size, and whether option A, B or C is possible.
3. **Write the full plan** for the chosen option (ADR-0047, the literal blocks, the dry run, the guardrails, the live checks).
4. Backend: manual items (keys, language), `GetMediaPdf`, tests in `test_media_service.lua`.
5. Kernel, domain, app: the item kind, the ordering, `createManuals`, the page bin, tests (the fakes of the renderer port).
6. Ports and the renderer (pdf.js or the chosen option) behind the `pdf` port.
7. Surface: the cover card (first row) and the viewer's page stack; the setting row; docs (`service-media.md`,
   `surfaces.md`, `rpc.md`, `kernel.md`, the ADR).
8. Live verification (below) and the CHANGELOG entry.

## 6. Guardrails this touches (to be ticked in the full plan)

1 (ids: the manual card's file id comes from the same 9e14 range), 2 (O(1): the jsx checks stay property reads), 11/12 (every
window, no per-window install), 15 (no check weakened), 17 (a render never starts work: the download starts from an effect on
the user's click), ADR-0014 (a failed manual drops its card only), ADR-0041 (no new `keepJsxPatched` site: the viewer branch
joins `surfaces/community`'s existing hook), the F2 rule that no ScreenScraper URL leaves the backend and nothing is written to disk.

## 7. Do-not-touch and banned actions (as F2)

The F2 plan's § 4 and § 5 apply. In addition: no new dependency is installed without the user's approval (Option A needs
one), no PDF or page image is written to disk, no manual is opened in a browser.

## 8. Live verification (sketch; exact PASS lines in the full plan)

On a game whose ScreenScraper page has a manual, in desktop and Big Picture: the first card of the Community section is the
manual cover and occupies the first row; clicking it opens Steam's viewer with the page stack; the controller D-pad (and the
mouse wheel) scrolls through every page; closing and reopening is instant (page cache); a game with no manual shows no card; a
game whose manual fails to download shows no card and no error; `communityShowManuals` off hides it; native games and the
mapped game are untouched; `npm run test:live` stays 12/12; no file under `C:\game\steam` is created.
