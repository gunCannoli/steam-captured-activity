import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { CarouselClasses as CC, cx } from './classes';

/**
 * Steam's real scrolling-carousel primitive, reimplemented from its own
 * source rather than approximated from markup.
 *
 * Walked live from the running client: the Post-Game Summary's carousel is
 * NOT `@steambrew/client`'s exported `Carousel` (that one is a windowed,
 * index-based virtualizer - `fnItemRenderer`/`nNumItems`/`fnGetColumnWidth` -
 * built for long uniform lists like the friends list or a store shelf).
 * Steam's own Post-Game Summary uses a different, unexported pair of
 * components (module `4584`'s `Pageable`, wrapping module `26271`'s plain
 * `Carousel`) that scrolls real DOM children directly and has no
 * virtualization at all - a much closer fit for a handful of variable-size
 * tiles. `@steambrew/client` does not re-export either, so this reproduces
 * `26271`'s actual behaviour:
 *
 *   - a plain horizontally-scrolling flex row (`overflow-x` comes from the
 *     `BoxCarousel` class itself, not an inline style)
 *   - a `ResizeObserver` on the scrolling div re-checks overflow whenever its
 *     size changes (window resize, tiles added/removed)
 *   - `bLeftEnabled`/`bRightEnabled` are computed from `scrollLeft` /
 *     `clientWidth` / `scrollWidth`, then handed to the caller via
 *     `onUpdateArrows` - the caller (Pageable, see pageable.tsx) uses these
 *     to decide whether to render the arrows AT ALL, not just whether to
 *     grey them out. Confirmed live: native's own Post-Game Summary renders
 *     NO pager arrows whatsoever when every tile already fits one row - only
 *     `PageableCloseButton` shows. This is why our earlier "fake disabled
 *     arrows" idea would have been wrong to build: native never shows a
 *     disabled arrow pair, it omits them.
 *   - Left/Right scroll by one child's width at a time (the next/previous
 *     child that isn't already fully visible), not by a fixed pixel amount
 *     or a full page - verified in module `26271`'s `ScrollLeft`/`ScrollRight`.
 *
 * `data-carousel="ignore"` marks children this carousel's own visibility math
 * should skip (spacers, padding elements) - Steam's real markup uses the same
 * attribute for `TypeSeparator`/`ForcedCarouselPadding`, so consumers of this
 * component should keep using it for the same purpose.
 */

export interface ItemCarouselHandle {
  scrollLeft(): void;
  scrollRight(): void;
}

interface Props {
  children: ReactNode;
  ariaLabel?: string;
  onUpdateArrows?: (leftEnabled: boolean, rightEnabled: boolean) => void;
  className?: string;
}

/** True for a child the real carousel's own visibility math skips. */
function isIgnored(el: Element): boolean {
  return el.getAttribute('data-carousel') === 'ignore';
}

/** An element's leading edge in scroll space (`offsetLeft`; no RTL tiles here). */
function leadingEdge(el: HTMLElement): number {
  return el.offsetLeft;
}

/** Whether `el` is already fully within the scrolling div's visible range. */
function fullyVisible(el: HTMLElement, scroller: HTMLElement): boolean {
  const start = el.offsetLeft;
  const end = start + el.offsetWidth;
  const viewEnd = scroller.scrollLeft + scroller.clientWidth;
  return start >= scroller.scrollLeft && end <= viewEnd;
}

/** Cubic ease-in-out, matching the "cubic-in-out" timing native's own scroll
 * animation names (module `26271` hands `timing: "cubic-in-out"` to its own
 * animation helper) - not the default linear/ease the browser's native
 * `scrollTo({behavior:'smooth'})` would apply if it worked here at all. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Animates `scrollLeft` by hand over `durationMs`, rather than trusting
 * `Element.scrollTo({behavior:'smooth'})`.
 *
 * Found live, not assumed: in this CEF/Steam environment,
 * `scrollTo({behavior:'smooth'})` is a silent no-op - `scrollLeft` never
 * changes, with no error and no exception, while `behavior:'auto'` on the
 * exact same call works instantly. Confirmed by monkeypatching `scrollTo` to
 * trace calls: the correct target was computed and passed every time; only
 * the smooth variant failed to apply. Native's own carousel never actually
 * relies on the browser's smooth-scroll for this reason - module `26271`
 * animates `scrollLeft` itself via its own small animation helper
 * (`new u.JV(el, {scrollLeft}, {msDuration:500, timing:"cubic-in-out"})`),
 * which is what this reproduces, at the same 500ms duration.
 *
 * A SECOND bug found live while testing the first fix: setting `scrollLeft`
 * from JS in this same environment never dispatches a native `scroll` event
 * at all (confirmed by attaching a listener and polling a counter across a
 * full second - it stayed at 0 through an animation that visibly moved
 * `scrollLeft` from 0 to 308). `ItemCarousel`'s `onScroll={updateArrows}` is
 * therefore dead code here, not just throttled - the arrows would freeze at
 * whatever state they had before the first scroll and never update again.
 * `onFrame` lets the animation itself drive the arrow re-check every frame,
 * standing in for the `scroll` event this environment won't deliver.
 */
function animateScrollLeft(
  el: HTMLElement,
  to: number,
  onFrame: () => void,
  durationMs = 500,
): void {
  const from = el.scrollLeft;
  const delta = to - from;
  if (delta === 0) {
    onFrame();
    return;
  }

  const start = performance.now();

  function step(now: number) {
    const elapsed = now - start;
    const t = Math.min(1, elapsed / durationMs);
    el.scrollLeft = from + delta * easeInOutCubic(t);
    onFrame();
    if (t < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

export const ItemCarousel = forwardRef<ItemCarouselHandle, Props>(function ItemCarousel(
  { children, ariaLabel, onUpdateArrows, className },
  ref,
) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [onLastPage, setOnLastPage] = useState(true);

  const updateArrows = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const leftEnabled = scroller.scrollLeft >= 1;
    const rightEnabled = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth;

    setOnLastPage(!rightEnabled);
    onUpdateArrows?.(leftEnabled, rightEnabled);
  }, [onUpdateArrows]);

  // Re-check on every size change, not just on scroll - a resize can create
  // or remove overflow without the user ever scrolling (verified: this is
  // exactly how native re-hides the arrows if the window grows wide enough
  // to fit every tile in one row).
  const resizeObserver = useMemo(
    () => new ResizeObserver(() => updateArrows()),
    [updateArrows],
  );

  const bindScroller = useCallback(
    (el: HTMLDivElement | null) => {
      if (scrollerRef.current) resizeObserver.disconnect();
      scrollerRef.current = el;
      if (el) {
        resizeObserver.observe(el);
        // Layout may not have settled yet on the same tick as the ref
        // callback (tiles' images haven't decoded, widths can still be 0) -
        // defer one frame, matching the intent of native's own
        // componentDidMount->UpdateScrollArrows call.
        requestAnimationFrame(() => updateArrows());
      }
    },
    [resizeObserver, updateArrows],
  );

  // Native's own carousel calls UpdateScrollArrows from BOTH
  // componentDidMount (handled above via bindScroller) AND componentDidUpdate
  // (module `26271`: `componentDidUpdate(){this.UpdateScrollArrows()}`) - not
  // only on a ResizeObserver firing. That distinction matters here: a
  // ResizeObserver watching the scroller element only fires on a change to
  // THAT element's own box, not on its scrollable content growing while its
  // own box stays flex-clamped to its parent's width - exactly what happens
  // when tiles are added/removed (e.g. a growing Post-Game Summary) without
  // the surrounding page changing size. Re-checking on every commit closes
  // that gap the same way native's class-component lifecycle does.
  useEffect(() => {
    updateArrows();
  });

  const findFirstVisibleChild = useCallback((scroller: HTMLElement): HTMLElement | null => {
    const kids = Array.from(scroller.children) as HTMLElement[];
    for (const kid of kids) {
      if (leadingEdge(kid) >= scroller.scrollLeft) return kid;
    }
    return null;
  }, []);

  const scrollLeft = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const kids = Array.from(scroller.children) as HTMLElement[];
    const first = findFirstVisibleChild(scroller);
    const firstIndex = first ? kids.indexOf(first) : -1;

    if (firstIndex <= 0) {
      animateScrollLeft(scroller, 0, updateArrows);
      return;
    }

    // Walk backward from the first visible child to find the previous tile
    // that isn't already (fully) on screen - matches native scrolling by one
    // "page" of newly-revealed tiles rather than by a fixed pixel amount.
    let target: HTMLElement | null = null;
    for (let i = firstIndex - 1; i >= 0; i--) {
      const kid = kids[i];
      if (!kid || isIgnored(kid)) continue;
      if (!fullyVisible(kid, scroller)) {
        target = kid;
        break;
      }
    }
    animateScrollLeft(scroller, target ? leadingEdge(target) : 0, updateArrows);
  }, [findFirstVisibleChild, updateArrows]);

  const scrollRight = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const kids = Array.from(scroller.children) as HTMLElement[];
    const first = findFirstVisibleChild(scroller);
    const firstIndex = first ? kids.indexOf(first) : -1;
    if (firstIndex < 0) return;

    let target: HTMLElement | null = null;
    for (let i = firstIndex; i < kids.length; i++) {
      const kid = kids[i];
      if (!kid || isIgnored(kid)) continue;
      if (!fullyVisible(kid, scroller)) {
        target = kid;
        break;
      }
    }
    animateScrollLeft(scroller, target ? leadingEdge(target) : scroller.scrollWidth, updateArrows);
  }, [findFirstVisibleChild, updateArrows]);

  useImperativeHandle(ref, () => ({ scrollLeft, scrollRight }), [scrollLeft, scrollRight]);

  return (
    <div className={cx(CC.BoxCarousel, className)}>
      <div
        ref={bindScroller}
        role="list"
        aria-label={ariaLabel}
        className={cx(CC.BoxCarouselContents, !onLastPage && CC.MaskRight, onLastPage && CC.OnLastPage)}
        // Native's own carousel updates via this event too. Kept even though
        // it's a confirmed no-op in this specific CEF/Steam build (see
        // animateScrollLeft's doc comment) - `scrollLeft()`/`scrollRight()`
        // already re-check via their own `onFrame` callback regardless, and a
        // real `scroll` event (mouse wheel/trackpad over the carousel,
        // touch drag) may still fire normally even where the JS-set-scrollLeft
        // case does not, so this stays as a correct-where-possible safety net
        // rather than dead weight to strip out.
        onScroll={updateArrows}
      >
        {children}
      </div>
    </div>
  );
});
