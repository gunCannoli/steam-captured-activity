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

Measured tree, outermost first:

| Element | Size | Background | Padding | Margin | Radius |
| --- | --- | --- | --- | --- | --- |
| `SpotlightLeftColumn` (parent) | 892×323 | none | `0 0 0 10px` | `0` | `0` |
| `GamePlaySummaryContainer` | 882×213 | **none** | `0` | `20px 0` | `0` |
| `GamePlaySummaryHeader` | 172×28 | none | `0` | `0` | `0` |
| `SummaryCarouselContainer` | 882×185 | **radial gradient** ↓ | `10px 0 5px` | `0` | `3px` |
| `SummaryCarouselScrolling` | 882×170 | none | `0` | `0` | `0` |
| `SummaryScreenshot` / `PostGameSummaryClip` | **224×126** | none | `0` | `0` | `0` |
| `ClipThumbnail` | 224×126 | `rgb(0, 0, 0)` | `0` | `0` | `0` |

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
width: 224px;
height: 126px;          /* 16:9 */
box-shadow: rgb(0, 0, 0) 2px 2px 8px 0px;
border-radius: 0;       /* square corners, not rounded */

/* ClipThumbnail, the <img> inside a clip tile */
background: rgb(0, 0, 0);
```

Note the shadow is **offset** (`2px 2px`), not centred, and fully opaque black.

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
