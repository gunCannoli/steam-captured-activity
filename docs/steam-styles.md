# Steam style bible

Values **measured from the live Steam client**, not read off screenshots. Every
figure here came from `getComputedStyle` on a native game's app detail page
(Divinity: Original Sin 2, which has both screenshots and a clip).

Copy these instead of approximating. Guessing from a screenshot produced three
rounds of visible mismatch; measuring produced an exact match in one.

> **Re-measuring:** the extraction approach is in
> [ADR-0021](decisions.md#adr-0021-measure-steams-styles-from-the-live-client-and-keep-a-style-bible).
> Steam's hashed class names change between builds, so always select with
> `[class*="ReadableName"]` — the DOM carries both the hash and the readable
> half (`_1OMmVJ… GamePlaySummaryContainer`).

---

## Typography

Font stack throughout:

```css
font-family: "Motiva Sans", Arial, Helvetica, sans-serif;
```

| Role | Size / weight / letter-spacing / line-height | Color | Transform |
| --- | --- | --- | --- |
| Section header (`GamePlaySummaryHeader`) | `14px / 400 / 1px / 28px` | `rgb(148, 161, 166)` | uppercase |
| Activity day (`AppActivityDate`) | `14px / 400 / 1px` | `rgb(138, 138, 138)` | uppercase |
| Event headline (`EventHeadline`) | `14px / 400 / normal` | `rgb(138, 138, 138)` | none |
| Play-bar label (`PlayBarLabel`) | `14px / 400 / 1px` | `rgba(255, 255, 255, 0.52)` | uppercase |
| Play-bar value (`PlayBarDetailLabel`) | `13px / 400 / normal` | `rgba(255, 255, 255, 0.32)` | none |

**Section headers are weight 400, not bold.** They read as prominent because of
the uppercase and letter-spacing, not the weight — bolding them is the single
most visible way to look non-native.

---

## Post-game summary

> **The full real DOM tree** — including the header-row/pager/close-button
> structure this section originally didn't cover — is in
> [knowledgebase.md § The real Post-Game Summary DOM, verbatim](knowledgebase.md#the-real-post-game-summary-dom-verbatim-verified-live-cef-devtools-session).
> Read that first; the tables below are computed-style values layered on top of
> that tree, from an earlier, narrower probe.

Measured tree, outermost first:

| Element | Size | Background | Padding | Margin | Radius |
| --- | --- | --- | --- | --- | --- |
| `SpotlightLeftColumn` (parent) | 892×323 | none | `0 0 0 10px` | `0` | `0` |
| `PageableContainer` (= `GamePlaySummaryContainer`'s wrapper) | 882×213 | **none** | `0` | `20px 0` | `0` |
| `GamePlaySummaryHeader` | 172×28 | none | `0` | `0` | `0` |
| `SummaryCarouselContainer` | 882×185 | **radial gradient** ↓ | `10px 0 5px` | `0` | `3px` |
| `SummaryCarouselScrolling` | 882×170 | none | `0` | `0` | `0` |
| `SummaryScreenshot` / `PostGameSummaryClip` | **224×126 as rendered** | none | `0` | `0` | `0` |
| `ClipThumbnail` | 224×126 as rendered | `rgb(0, 0, 0)` | `0` | `0` | `0` |

> **Correction:** `224×126` is a *rendered* size captured at one window width,
> not the authored size. The actual markup sets `style="aspect-ratio: 1.77778 / 1"`
> (16:9) on both tile types with no fixed `width`/`height` — the tile is meant to
> flex with its container. Fix a pixel width only if you also fix the number of
> tiles per row; prefer `aspect-ratio` + a flexible width to match Steam's own
> approach.

### The carousel panel

The subtle darker box around the carousel is a **gradient**, not a
`background-color` — which is why an earlier check for `backgroundColor`
reported `rgba(0,0,0,0)` and the panel was wrongly removed:

```css
background-image: radial-gradient(
  100% 150% at 33% 45%,
  rgba(29, 34, 43, 0.3) 0%,
  rgba(10, 11, 14, 0.3) 100%
);
border-radius: 3px;
padding: 10px 0 5px;
```

It sits on `SummaryCarouselContainer` only. `GamePlaySummaryContainer` and the
scrolling child are both transparent — adding a panel to either doubles it up.

### Media tiles

```css
/* SummaryScreenshot and PostGameSummaryClip */
aspect-ratio: 1.77778 / 1;   /* 16:9, authored — NOT a fixed 224x126 box */
box-shadow: rgb(0, 0, 0) 2px 2px 8px 0px;
border-radius: 0;            /* square corners, not rounded */

/* ClipThumbnail, the <img> inside a clip tile */
background: rgb(0, 0, 0);
```

Note the shadow is **offset** (`2px 2px`), not centred, and fully opaque black.

### Clip duration badge

Measured live against a real native clip tile (Divinity: Original Sin 2,
appid 435150), diffed against ours after a color/size bug (see TASK.md Phase
5c item 4):

```css
/* DurationText.Clip, the corner badge on a recording's tile */
color: rgb(255, 213, 95);    /* amber/yellow — NOT DurationText's own blue */
font-size: 13px;
```

`DurationText` alone (no `Clip` modifier) is Steam's default highlight blue,
`rgb(26, 159, 255)` — the amber only applies when **both** classes are
present, in the order `"DurationText Clip"`. Passing a literal `'Clip'`
string instead of the resolved `ClipClasses.Clip` hash compiles fine (nothing
type-checks the string) but silently drops the amber rule, since the hash for
`.Clip` never ends up on the element.

The scissors icon inside the badge is authored at `width="24" height="24"` on
the `<svg>` itself. It does **not** render as a 24×24 square — measured
rendered size is a non-square ~20×25px — because `DurationText`/`Clip`'s own
padding and line-height constrain the box, not the SVG's own attributes.
Hardcoding a smaller attribute (we had `14×14`) makes the icon smaller than
native regardless of color, independent of the color bug above.

### Post-Game Summary dismiss button

```
_2dB1oJFsqNThak1cFya2-q PageableCloseButton _3qlJ0L41KQFqUTzVQKFERC Small
```

Two hashes, not one — `PageableCloseButton` and `Small` are each their own
class token in `PageableClasses` (module `29158`), and **`Small` itself
resolves to a two-token string** (`"_3qlJ0L41KQFqUTzVQKFERC Small"`), not a
bare hash the way most single-word modifiers do elsewhere in this codebase.
Passing the literal string `'Small'` instead of `PageableClasses.Small`
compiles fine but drops that hash, silently losing whatever rule it scopes
(sizing/positioning of the button within its row). Computed result once both
`PageableCloseButton` and `Small` are the real resolved values:

```css
width: 16px; height: 16px;
background-color: rgba(0, 0, 0, 0);
color: rgb(221, 221, 221);
```

The button is also a real `<div role="button">`, never a `<button>` element —
a real `<button>` carries browser-default chrome (white/grey background,
border) this class was never written to reset.

### Header row (missed in the first pass — see the knowledgebase tree)

`GamePlaySummaryHeader` is not a lone floating title. It sits inside
`HeaderPageControls`, alongside the pager and the summary's own dismiss button:

```
HeaderPageControls               (flex row, header text left, controls right)
├─ GamePlaySummaryHeader           "Post-Game Summary" (text-transform: uppercase)
└─ PageClickContainer
   ├─ PageLeft  [.Disabled at start]   -- SVG arrow, transform: scale(-1, 1)
   ├─ PageRight [.Disabled at end]     -- same SVG arrow, not flipped
   └─ PageableCloseButton              -- the "X"; dismisses the whole summary
```

`.Disabled` is a plain class Steam toggles based on scroll position — there is
no separate ARIA `disabled` attribute to manage by hand if you reuse this
structure (e.g. via `@steambrew/client`'s `Carousel`, which likely implements
the same paging state).

---

## Checking a value

From a CEF devtools session on `SharedJSContext`:

```js
const m = window.g_PopupManager.m_mapPopups; let doc = null;
m.forEach(v => { if ((v?.m_strName || '').startsWith('SP Desktop')) doc = v.window.document; });

const el = doc.querySelector('[class*="SummaryCarouselContainer"]');
const cs = doc.defaultView.getComputedStyle(el);
console.log(cs.backgroundImage, cs.boxShadow, cs.padding, cs.borderRadius);
```

Check `backgroundImage` as well as `backgroundColor`; Steam uses gradients in
several places where a flat colour would be expected.

---

## Open questions

- **Animated clip previews.** Steam animates a recording's thumbnail on hover.
  The mechanism is not yet identified — possibly a short video element, a
  sprite sheet, or an animated image swapped in on hover.
- **Achievement tiles** in the summary (`SummaryAchievement`,
  `SummaryAchievementIcon`, `SummaryAchievementStack`) are not yet measured;
  they matter once a provider contributes achievements.

## Resolved

- ~~Clip icon shape~~ — it is a specific Steam SVG with real path data
  (`DurationText.Clip > svg`), not a generic scissors glyph. Full markup in
  [knowledgebase.md](knowledgebase.md#the-real-post-game-summary-dom-verbatim-verified-live-cef-devtools-session).
  Copy the path verbatim rather than redrawing.
- ~~How the pager arrows relate to the carousel~~ — they don't flank it; they
  sit in `HeaderPageControls` next to the title and the summary's own dismiss
  button, above the carousel. See the header-row diagram above.
