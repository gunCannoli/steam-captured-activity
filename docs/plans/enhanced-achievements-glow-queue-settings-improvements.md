# Fix plan: `enhanced-achievements` glow removal, capture slider range, settings row layout, queue toggle

> Bugfix/improvement plan for the implementer, following on from
> [enhanced-achievements-animation-queue-improvements.md](enhanced-achievements-animation-queue-improvements.md)
> (executed, commit `db93e79`). User feedback (2026-09-25, after that landed):
> 5 items, of which 2 (dropdown width/text size, button padding) are **out of
> scope by user decision** — see § 1.3/1.4 below. **No scope beyond what is
> listed here.**
>
> Written 2026-09-25 from source reading (`frontend/banner/*`,
> `frontend/settings/*`, `frontend/capture/plan.ts`) plus the `@steambrew/client`
> SDK's type declarations (`node_modules/@steambrew/client/build/components/*.d.ts`).
> No module ids are used; nothing here resolves by one.

---

## 1. The five requests, and what each needs

### 1.1 Glow: drop the effect entirely (user decision)

Current `.ea-glow`/`.ea-pulse` (`frontend/banner/styles.ts`) render the glow on
a `::before` pseudo-element that is a **child of `.ea-banner`**, and
`.ea-banner` has `overflow: hidden` — so the glow's `box-shadow` is clipped to
the banner's own box, which is why it reads as an inner effect instead of an
outline. Worse: the toast **popup window is resized to exactly the banner's
size** (`window-pin.ts`'s `ResizeTo(size.width, size.height, true)`, driven by
the geometry fix), so there is no spare window space for a glow to bleed into
even if the CSS clipping were fixed — a real, visible outline glow needs the
window made larger than the banner and the banner centred inside it, which
touches the geometry fix's resize/placement math.

**User decision (2026-09-25):** drop the glow effect rather than do either the
partial fix (still hard-cut at the window edge) or the invasive one (resize
math change). The theme schema keeps parsing `banner.glow` (so no existing
theme file needs editing, warns, or breaks — themes.md's own "graceful
fallback" rule) — only the CSS classes and the class-list logic that applies
it are removed. `glow` becomes an accepted-but-inert field, the same category
`box` (the `banner` alias) already occupies.

### 1.2 `recording.duration_s` slider: start at 0, not 5

`frontend/capture/plan.ts`'s `CAPTURE_RANGES['recording.duration_s']` is
`{ min: 5, max: 60, step: 5 }`. User wants `{ min: 0, max: 60, step: 5 }`.
This range is the single source for both the settings panel's `SliderField`
(`settings-panel.tsx`'s `Slider` component reads `RANGES[k]`) and the
per-tier theme override clamp in `resolveCaptureSettings` (same file,
`CAPTURE_RANGES['recording.duration_s'].min/.max`) — one number change fixes
both. A `duration_s` of `0` combined with `recording.enabled: true` means "no
window" (start === end in `captures.ts`'s clip math); that already degrades
sensibly (Steam's `SaveClip` will reject or produce a near-zero clip, handled
by the existing try/catch in `steam/recording.ts`, not a new failure mode this
plan introduces).

### 1.3 & 1.4: dropdown size/text and button padding — **out of scope** (user decision)

`DropdownItemProps` and `ButtonItemProps` (`@steambrew/client` type
declarations) expose no `style`/`className` prop, so neither can be sized
without either targeting Steam's own resolved CSS module classes (a first for
this settings panel, whose own doc comment says "no custom CSS, so focus and
controller navigation come for free") or accepting Steam's stock sizing.
**User decision (2026-09-25):** skip both; only fix what the SDK's own props
allow (§ 1.5 below covers the layout half of the original request with a
supported prop). Recorded here so the two items are not silently dropped
without a paper trail — no code change for either.

### 1.5 Two-row settings layout: `label + control` then `description` below

`ItemProps` (`@steambrew/client/build/components/Item.d.ts`) already has
`layout?: 'below' | 'inline'`. This is exactly the two-row shape requested —
row 1 is the label and its control (toggle/slider/dropdown/button), row 2 is
the description on its own line — and it needs **zero custom CSS**, matching
the panel's existing "SDK components only" design. Every `Toggle`, `Slider`,
`ThemeSection`'s `DropdownItem`, and every `ButtonItem` in the panel currently
lets `layout` default (unset); this plan sets `layout="below"` everywhere a
`description` is passed, so the description never sits under the control on
the same visual row.

### 1.6 A queue on/off setting

**User decision (2026-09-25):** the one-at-a-time queue (already shipped,
commit `db93e79`) should be optional — a `ToggleField` in the settings panel,
off by default falling back to Steam's own default stacking behaviour
(multiple toasts side by side, today's pre-queue behaviour), on to use the new
queue. New setting key `queue.enabled`. When off, `Banner` skips
`requestTurn`/`releaseTurn` entirely and always renders immediately — not
"always call `requestTurn` but have it always say yes," so the queue module's
internal state never accumulates entries for toasts that never asked to be
gated, keeping `banner/queue.ts` itself unaware of the setting (it stays pure,
per its own doc comment).

---

## 2. Preconditions

Run in `enhanced-achievements/`:

| Command | Expected |
| --- | --- |
| `git status --short` | empty |
| `npm run check` | only the npm banner, exit 0 |
| `npm test` | `ℹ tests 50` / `ℹ pass 50` / `ℹ fail 0` |

---

## 3. Ordered steps

### Phase 1: drop the glow effect (item 1)

**Step 1.1: `frontend/banner/themed-toast.tsx`, className — remove the glow/pulse class suffixes.**

Before:
```tsx
            className={`ea-banner ea-layout-${theme.layout} ea-in-${theme.animation.in} ea-out-${theme.animation.out} ea-pos-${theme.position} ea-tier-${tier.tier}${banner.glow.spread > 0 ? ' ea-glow' : ''}${banner.glow.pulseMs > 0 ? ' ea-pulse' : ''}`}
```
After:
```tsx
            className={`ea-banner ea-layout-${theme.layout} ea-in-${theme.animation.in} ea-out-${theme.animation.out} ea-pos-${theme.position} ea-tier-${tier.tier}`}
```

**Step 1.2: `frontend/banner/themed-toast.tsx`, `rootStyle` — drop the now-unused glow CSS variables.**

Before:
```ts
    const rootStyle = {
        '--ea-inner-h': `${size.innerH}px`,
        '--ea-pad-y': `${banner.padding[0]}px`,
        '--ea-pad-x': `${banner.padding[1]}px`,
        '--ea-gap-x': `${banner.gap[0]}px`,
        '--ea-gap-y': `${banner.gap[1]}px`,
        '--ea-glow': banner.glow.color,
        '--ea-glow-spread': `${banner.glow.spread}px`,
        '--ea-glow-pulse': `${banner.glow.pulseMs}ms`,
        '--ea-text-align': textAlign,
```
After:
```ts
    const rootStyle = {
        '--ea-inner-h': `${size.innerH}px`,
        '--ea-pad-y': `${banner.padding[0]}px`,
        '--ea-pad-x': `${banner.padding[1]}px`,
        '--ea-gap-x': `${banner.gap[0]}px`,
        '--ea-gap-y': `${banner.gap[1]}px`,
        '--ea-text-align': textAlign,
```

Run: `npm run check`. Expected: exit 0 (`banner.glow` is still read elsewhere
— `theme.ts`'s resolution — so no unused-variable error; `banner` itself is
still used for padding/gap/etc.).

**Step 1.3: `frontend/banner/styles.ts`, delete the glow CSS block.**

Before:
```css
/* Exterior outline glow (isolated on ::before to never conflict with entrance animations) */
.ea-banner.ea-glow::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: 0 0 var(--ea-glow-spread) var(--ea-glow);
    pointer-events: none;
    z-index: -1;
}
.ea-banner.ea-pulse::before {
    animation: ea-pulse var(--ea-glow-pulse, 1500ms) ease-in-out infinite alternate;
}

.ea-banner.ea-layout-compact_pill {
```
After:
```css
.ea-banner.ea-layout-compact_pill {
```
(The two glow rules and their connecting blank line are deleted; the
`compact_pill` rule right after them is untouched and now follows directly.)

**Step 1.4: `frontend/banner/styles.ts`, delete the `ea-pulse` keyframes.**

Before:
```css
/* Pulsing outline glow fade */
@keyframes ea-pulse {
    0%, 100% {
        box-shadow: 0 0 calc(var(--ea-glow-spread) * 0.4) var(--ea-glow);
        opacity: 0.6;
    }
    50% {
        box-shadow: 0 0 var(--ea-glow-spread) var(--ea-glow);
        opacity: 1;
    }
}

/* Base Icon and Scaling */
```
After:
```css
/* Base Icon and Scaling */
```

**Step 1.5: `themes.md`, note that `glow` is parsed but inert.**

Find the line:
```
- **`glow`**: `["#hex", spread_px, pulse_ms]` — exterior outline glow outside the banner card. `spread_px` `0` disables glow; `pulse_ms` `0` is steady, `1500` animates a gentle breathing fade in/out every 1.5 s.
```
Replace with:
```
- **`glow`**: *(parsed, currently has no visual effect — the outline-glow
  render was removed; kept in the schema so existing theme files do not warn
  or break)*.
```

Run: `npm run check && npm test`. Expected: exit 0, `ℹ pass 50` / `ℹ fail 0`
(no test asserts `ea-glow`/`ea-pulse` class presence — confirm with
`grep -rn "ea-glow\|ea-pulse" tests/` before running, expect no output).

### Phase 2: capture slider range (item 2)

**Step 2.1: `frontend/capture/plan.ts`, `CAPTURE_RANGES`.**

Before:
```ts
export const CAPTURE_RANGES = {
    'screenshot.delay_ms': { min: 0, max: 5000, step: 100 },
    'recording.duration_s': { min: 5, max: 60, step: 5 },
    'recording.delay_ms': { min: 0, max: 5000, step: 100 },
} as const;
```
After:
```ts
export const CAPTURE_RANGES = {
    'screenshot.delay_ms': { min: 0, max: 5000, step: 100 },
    'recording.duration_s': { min: 0, max: 60, step: 5 },
    'recording.delay_ms': { min: 0, max: 5000, step: 100 },
} as const;
```

Run: `npm run check && npm test`. Expected: exit 0, `ℹ pass 50` / `ℹ fail 0`
(no test hardcodes the old `min: 5` — confirmed by `grep -n "duration_s"
tests/capture.test.ts`, only two hits, neither asserts the range bounds).

### Phase 3: two-row settings layout (item 1.5 above)

**Step 3.1: `frontend/settings/settings-panel.tsx`, `Toggle`.**

Before:
```tsx
function Toggle({ k, label, description, disabled }: { k: SettingKey; label: string; description?: string; disabled?: boolean }) {
    const [value, set] = useSetting(k);
    return <ToggleField label={label} description={description} checked={value as boolean} disabled={disabled} onChange={(v) => set(v as never)} />;
}
```
After:
```tsx
function Toggle({ k, label, description, disabled }: { k: SettingKey; label: string; description?: string; disabled?: boolean }) {
    const [value, set] = useSetting(k);
    return <ToggleField label={label} description={description} layout="below" checked={value as boolean} disabled={disabled} onChange={(v) => set(v as never)} />;
}
```

**Step 3.2: `frontend/settings/settings-panel.tsx`, `Slider`.**

Before:
```tsx
        <SliderField
            label={label}
            value={value as number}
            min={range.min}
            max={range.max}
            step={range.step}
            showValue
            valueSuffix={suffix}
            resetValue={DEFAULTS[k] as number}
            disabled={disabled}
            onChange={(v) => set(v as never)}
        />
```
After:
```tsx
        <SliderField
            label={label}
            layout="below"
            value={value as number}
            min={range.min}
            max={range.max}
            step={range.step}
            showValue
            valueSuffix={suffix}
            resetValue={DEFAULTS[k] as number}
            disabled={disabled}
            onChange={(v) => set(v as never)}
        />
```
(`Slider` has no `description` prop today, so this only affects how its label
row is laid out relative to the slider control itself — still worth setting
for visual consistency with every other row in the panel.)

**Step 3.3: `frontend/settings/settings-panel.tsx`, `ThemeSection`'s `DropdownItem` and its two `ButtonItem`s.**

Before:
```tsx
            <DropdownItem label="Theme" description={status} rgOptions={options} selectedOption={theme} onChange={(o) => setTheme(o.data as string)} />
            <ButtonItem
                label="Reload themes"
                description="Pick up edits to theme JSON files without restarting Steam."
                onClick={async () => {
                    await refresh();
                    await reloadTheme();
                }}
            >
                Reload
            </ButtonItem>
            <ButtonItem label="Open themes folder" description={userDir || 'Your themes live here and survive plugin updates.'} onClick={() => void rpc.openThemesFolder()}>
                Open
            </ButtonItem>
```
After:
```tsx
            <DropdownItem label="Theme" description={status} layout="below" rgOptions={options} selectedOption={theme} onChange={(o) => setTheme(o.data as string)} />
            <ButtonItem
                label="Reload themes"
                description="Pick up edits to theme JSON files without restarting Steam."
                layout="below"
                onClick={async () => {
                    await refresh();
                    await reloadTheme();
                }}
            >
                Reload
            </ButtonItem>
            <ButtonItem label="Open themes folder" description={userDir || 'Your themes live here and survive plugin updates.'} layout="below" onClick={() => void rpc.openThemesFolder()}>
                Open
            </ButtonItem>
```

**Step 3.4: `frontend/settings/settings-panel.tsx`, `PreviewSection`'s per-tier `ButtonItem`.**

Before:
```tsx
                <ButtonItem key={tier} label={TIER_LABELS[tier]} description={tierRule(tier)} onClick={() => void previewTier(tier)}>
                    Preview
                </ButtonItem>
```
After:
```tsx
                <ButtonItem key={tier} label={TIER_LABELS[tier]} description={tierRule(tier)} layout="below" onClick={() => void previewTier(tier)}>
                    Preview
                </ButtonItem>
```

**Step 3.5: `frontend/settings/settings-panel.tsx`, `CapturesSection`'s `Toggle`s, `Slider`s and `ButtonItem`.**

The `Toggle` and `Slider` calls inside `CapturesSection` already inherit
`layout="below"` from steps 3.1/3.2 (they call the shared `Toggle`/`Slider`
components, not `ToggleField`/`SliderField` directly) — no change needed to
those call sites themselves. Only the section's own `ButtonItem` needs it:

Before:
```tsx
            <ButtonItem
                label="Test captures"
                description={testDesc}
                onClick={() => {
```
After:
```tsx
            <ButtonItem
                label="Test captures"
                description={testDesc}
                layout="below"
                onClick={() => {
```

**Step 3.6: `frontend/settings/settings-panel.tsx`, `SettingsPanel`'s "Reset to defaults" `ButtonItem`.**

Before:
```tsx
            <ButtonItem label="Reset to defaults" description="Clear every changed setting." onClick={() => void resetSettings()}>
                Reset
            </ButtonItem>
```
After:
```tsx
            <ButtonItem label="Reset to defaults" description="Clear every changed setting." layout="below" onClick={() => void resetSettings()}>
                Reset
            </ButtonItem>
```

Run: `npm run check`. Expected: exit 0 (`layout` is a valid prop on
`ItemProps`, which every one of `ToggleField`/`SliderField`/`DropdownItem`/`ButtonItem`
extends — confirmed from their `.d.ts` files, all four `*Props` interfaces
extend `ItemProps`).

### Phase 4: queue on/off setting (item 5)

**Step 4.1: `frontend/settings/settings.ts`, add the setting key.**

Before:
```ts
export interface Settings {
    theme: string;
    'banner.enabled': boolean;
    'sound.enabled': boolean;
    'screenshot.enabled': boolean;
    'screenshot.delay_ms': number;
    'recording.enabled': boolean;
    'recording.duration_s': number;
    'recording.delay_ms': number;
    'recording.add_timeline_marker': boolean;
}
```
After:
```ts
export interface Settings {
    theme: string;
    'banner.enabled': boolean;
    'sound.enabled': boolean;
    'queue.enabled': boolean;
    'screenshot.enabled': boolean;
    'screenshot.delay_ms': number;
    'recording.enabled': boolean;
    'recording.duration_s': number;
    'recording.delay_ms': number;
    'recording.add_timeline_marker': boolean;
}
```

Before:
```ts
export const DEFAULTS: Settings = {
    theme: defaults.theme,
    'banner.enabled': defaults.banner.enabled,
    'sound.enabled': defaults.sound.enabled,
    'screenshot.enabled': defaults.screenshot.enabled,
```
After:
```ts
export const DEFAULTS: Settings = {
    theme: defaults.theme,
    'banner.enabled': defaults.banner.enabled,
    'sound.enabled': defaults.sound.enabled,
    'queue.enabled': defaults.queue.enabled,
    'screenshot.enabled': defaults.screenshot.enabled,
```

**Step 4.2: `settings.json`, add the default (off — see § 1.6).**

Before:
```json
{
    "theme": "steam_tiers",
    "banner": {
        "enabled": true
    },
    "sound": {
        "enabled": true
    },
    "screenshot": {
```
After:
```json
{
    "theme": "steam_tiers",
    "banner": {
        "enabled": true
    },
    "sound": {
        "enabled": true
    },
    "queue": {
        "enabled": false
    },
    "screenshot": {
```

Run: `npm run check`. Expected: exit 0 (`settings.json` is imported as a typed
JSON module in `settings.ts` — `defaults.queue.enabled` now resolves; TS's
JSON module resolution infers the shape from the file itself, so no separate
type declaration needs updating).

**Step 4.3: `frontend/banner/themed-toast.tsx`, gate the queue on the setting.**

Import. Before:
```tsx
import { releaseTurn, requestTurn } from './queue';
```
After:
```tsx
import { setting } from '../settings/settings';
import { releaseTurn, requestTurn } from './queue';
```

Queue gate. Before:
```tsx
    const [myTurn, setMyTurn] = useState(() =>
        requestTurn(n.data, () => setMyTurn(true), () => logger.warn('Achievement toast queue full; showing out of turn.')),
    );
    useEffect(() => () => releaseTurn(n.data), [n.data]);
    if (!myTurn) return null;
```
After:
```tsx
    const queueOn = setting('queue.enabled');
    const [myTurn, setMyTurn] = useState(() =>
        !queueOn || requestTurn(n.data, () => setMyTurn(true), () => logger.warn('Achievement toast queue full; showing out of turn.')),
    );
    useEffect(() => {
        if (!queueOn) return undefined;
        return () => releaseTurn(n.data);
    }, [n.data, queueOn]);
    if (!myTurn) return null;
```
`queueOn` is read once per toast mount (the setting does not change mid-toast;
the same "pinned once per toast" reasoning the placement `useLayoutEffect`
already documents applies here). When off, `requestTurn` is never called, so
`banner/queue.ts` never sees this toast — no entry to leak, and the animation-end
release effect below is skipped identically to avoid calling `releaseTurn` on
a key the queue never tracked (harmless either way, since `releaseTurn` on an
untracked key is a no-op by construction, but skipping keeps the intent
explicit — "the queue is off" reads the same way at both call sites).

The `animationend` release effect (added by the previous plan, step 3.3) also
needs the same guard, since it calls `releaseTurn` unconditionally today:

Before:
```tsx
    useEffect(() => {
        const el = rootRef.current;
        if (!el) return undefined;
        const onEnd = (e: AnimationEvent) => {
            if (e.animationName.startsWith('ea-out-')) releaseTurn(n.data);
        };
        el.addEventListener('animationend', onEnd);
        return () => el.removeEventListener('animationend', onEnd);
    }, [n.data]);
```
After:
```tsx
    useEffect(() => {
        if (!queueOn) return undefined;
        const el = rootRef.current;
        if (!el) return undefined;
        const onEnd = (e: AnimationEvent) => {
            if (e.animationName.startsWith('ea-out-')) releaseTurn(n.data);
        };
        el.addEventListener('animationend', onEnd);
        return () => el.removeEventListener('animationend', onEnd);
    }, [n.data, queueOn]);
```

Run: `npm run check`. Expected: exit 0.

**Step 4.4: `frontend/settings/settings-panel.tsx`, add the toggle.**

Before:
```tsx
            <Toggle k="banner.enabled" label="Themed banner" description="Off: Steam's own achievement toast." />
            <Toggle k="sound.enabled" label="Themed sound" description="Off: Steam's own chime. Steam's notification sound setting is always respected." />
            <CapturesSection />
```
After:
```tsx
            <Toggle k="banner.enabled" label="Themed banner" description="Off: Steam's own achievement toast." />
            <Toggle k="sound.enabled" label="Themed sound" description="Off: Steam's own chime. Steam's notification sound setting is always respected." />
            <Toggle k="queue.enabled" label="One achievement at a time" description="On: only one themed banner shows at once; a second unlock waits for the first to finish, then appears shortly after. Off: Steam's own default (toasts can show side by side)." />
            <CapturesSection />
```

Run: `npm run check && npm test && npm run build`. Expected: exit 0,
`ℹ pass 50` / `ℹ fail 0` (no new tests: `queue.enabled` is a plain boolean
setting with no pure-logic branching to unit test beyond what `settings.ts`'s
existing `validate`/`apply` machinery already covers generically — confirmed
by grepping `tests/*.test.ts` for any settings-schema test that enumerates
`Settings` keys by name; none does), `build Succeeded passing all tests`.

### Phase 5: docs

- `enhanced-achievements/CHANGELOG.md` `[Unreleased]`:
  - `### Removed` (new subsection): the outline glow effect — parsed but
    inert, with the reason (double-clipped by the banner's own overflow and
    the toast window's exact-fit size).
  - `### Changed`: `recording.duration_s` slider now starts at 0 (was 5);
    every settings-panel row now shows its control above its description
    (`layout="below"`, no custom CSS).
  - `### Added`: `queue.enabled` setting (off by default) — the one-at-a-time
    toast queue from the previous release is now opt-in.
- `themes.md`: already updated in Phase 1, step 1.5.
- `README.md`: if it lists `glow` as a feature, soften the wording the same
  way as the `themes.md` line (parsed, no current visual effect) — check with
  `grep -n glow README.md` first; if it is not mentioned there, skip this file.

Run: `npm run check && npm test`. Expected: unchanged (50/50).

---

## 4. Do not touch

- `frontend/banner/geometry.ts`, `frontend/banner/window-pin.ts` (no resize/
  placement math change — the glow decision in § 1.1 specifically avoided this).
- `frontend/banner/queue.ts` (stays pure/setting-unaware; the on/off gate lives
  in `themed-toast.tsx` only, per § 1.6).
- `frontend/steam/toast-patch.ts`, `frontend/steam/jsx-hook.ts`.
- `frontend/capture/**` outside `plan.ts`'s `CAPTURE_RANGES` (no other capture
  logic changes).
- `theme/theme.ts`'s `BannerStyle.glow` type and its parsing in `resolveTier`
  (kept exactly as-is — only the *consumer* in `themed-toast.tsx`/`styles.ts`
  is touched, per § 1.1's "parsed but inert" design).
- `DropdownItemProps`/`ButtonItemProps` sizing (§ 1.3/1.4 — out of scope by
  user decision).

## 5. Banned actions

No deploy or Steam restart (`dev.ps1`); the user deploys. No SharedJSContext
reload. No probe or throwaway plugins. No edits to Millennium's `config.json`,
plugin config, or user theme files. No `npm install`/upgrade. No
`git push --force`, no `--no-verify`. No custom CSS targeting Steam's own
resolved component classes (§ 1.3/1.4 — explicitly declined).

**Failure rule:** run a failing command at most twice. On the second failure,
stop. Append the command, its output (at most 30 lines) and the step number to
`TASK.md` § Active Failures & Blockers, then exit.

## 6. Guardrail checklist (plugins.md)

| Guardrail | Proof it is not violated |
| --- | --- |
| 1. Resolve by signature, never module id | No module resolution in this plan at all — every change is either this plugin's own files or a documented SDK prop (`layout`). |
| 4. Every hook falls through to Steam's original on any failure | Unaffected — no hook logic changes in this plan. |
| 14. A new gate must never remove working behaviour | `queue.enabled` defaults to `false`: today's shipped queue behaviour (commit `db93e79`) becomes opt-in, not silently removed — a user who wants it flips one toggle. Dropping the glow removes a visual effect the user explicitly asked to drop, not a functional regression. |
| Rules on every rung: graceful fallback | `banner.glow` still parses without warning on any existing theme file; an old theme with `glow` set simply has no visible effect now, never an error. |
| Steam-styles.md § Golden Rule | No hand-authored CSS targeting Steam's classes anywhere in this plan — `layout="below"` is a documented SDK prop, and the glow removal is a subtraction, not new CSS mimicking Steam. |

## 7. Commit

```
git add enhanced-achievements/frontend/banner/themed-toast.tsx enhanced-achievements/frontend/banner/styles.ts enhanced-achievements/frontend/capture/plan.ts enhanced-achievements/frontend/settings enhanced-achievements/settings.json enhanced-achievements/themes.md enhanced-achievements/CHANGELOG.md
git commit -m "fix(enhanced-achievements): drop clipped/windowless glow effect, capture slider floor, two-row settings layout, queue on/off toggle"
```

## 8. Live verification (user, after `dev.ps1` deploy)

**P1, glow gone.** With a theme that previously set `glow` (e.g.
`ps5_example.json`'s `magic`/`rare`/`exceptional` tiers), Preview those tiers:
no glow, pulsing or otherwise, around the banner. No console warning about the
`glow` field (it should parse silently, same as before this plan).

**P2, capture slider.** Open the plugin's settings panel, Captures section:
the "Clip length" slider's minimum is 0 s (was 5 s), maximum still 60 s.

**P3, settings row layout.** Every row in the panel (Theme dropdown, Reload/Open
buttons, tier Preview buttons, Themed banner/sound/queue toggles, every
Captures toggle and slider, Test captures and Reset buttons) shows its
label+control on the first line and its description on its own line below,
never overlapping.

**P4, queue toggle.** With "One achievement at a time" **off**, fire 3–4
unlocks close together (rapid Preview clicks or `tests/tiers.mjs`): toasts can
show side by side (today's Steam-default stacking, pre-queue). Turn it **on**,
repeat: only one banner is visible at any moment, the next appears about
100ms after the previous one's exit finishes — same behaviour verified for
the shipped queue in the previous plan's § 8 P3.

Then run the standing checks: `npm run check && npm test && npm run build`
(all clean, expect 50/50), `tests/tiers.mjs`, `tests/smoke.mjs`, and Routines
1–3 (`scratch/test_nav_cycle.js`, `scratch/check_all_tabs.js`) — unaffected by
this plan, but confirm no regression.

---

## 9. Open questions

1. **`queue.enabled` default** (§ 1.6, Step 4.2): `false` (Steam's own
   stacking, matching pre-queue behaviour and this plugin's existing "captures
   off by default" precedent for opt-in features). OK, or should it default
   `true` now that it is a supported feature rather than always-on?
2. **`recording.duration_s` at 0** (§ 1.2): the plan does not special-case a
   0-length clip beyond what the existing `steam/recording.ts` try/catch
   already tolerates. If Steam's `SaveClip` behaves oddly at `duration_s: 0`
   in practice (P2's live check should reveal this), a follow-up may be
   needed — not blocking this plan.

**Dry-run (2026-09-25): done.** All 4 code phases (Phase 5 is docs-only)
applied verbatim to a scratch copy — every before block matched exactly, no
staleness. `npx tsc --noEmit` clean, `npm test` `ℹ tests 50` / `ℹ pass 50` /
`ℹ fail 0` (unchanged from before this plan, as expected: no new pure-logic
tests were added, per § Step 4.4's own note).
