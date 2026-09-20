import { createElement, forwardRef, useImperativeHandle, useRef } from 'react';
import type { ReactNode } from 'react';
import { findModuleExport } from '@steambrew/client';
import { PageableClasses as P, SummaryClasses as S, cx } from './classes';

/**
 * Steam's REAL Post-Game Summary shell (header, dismiss button, pager
 * arrows, scrolling body) - not a hand-built clone of it.
 *
 * PRINCIPLE (see AGENTS.md "Reuse Steam's real components"): once a real,
 * working Steam component is confirmed reachable, render IT instead of
 * reimplementing its markup/behaviour by hand - even after a hand-built copy
 * has already been built and verified. "Looks the same" drifts from native
 * over time (spacing tweaks, animation changes, a future Steam UI
 * refresh); rendering the actual component cannot drift, by construction.
 * This file used to contain ~150 lines reimplementing Steam's scrolling
 * carousel (`ResizeObserver`, manual scroll animation, arrow enable/disable
 * math) after finding `@steambrew/client`'s own exported `Carousel` was the
 * wrong shape for this UI (a windowed, index-based virtualizer built for
 * long uniform lists, not a handful of variable-size tiles) - see git
 * history and knowledgebase.md for that investigation. It is replaced here
 * by rendering the exact components Steam itself uses.
 *
 * Steam's own Post-Game Summary (decompiled, module `53074`) composes two
 * unexported class components:
 *
 *   <Pageable name="Post-Game Summary" bNoHeader={false}
 *             customheader={<div className={GamePlaySummaryHeader}>
 *               Post-Game Summary</div>}
 *             bShowCloseButton onCloseButtonClicked={dismiss}
 *             buttonSize="small" headerPadding="0px 8px 0px 0px">
 *     {(ref, fnUpdateArrows) => (
 *       <Carousel ref={ref} fnUpdateArrows={fnUpdateArrows}
 *                 className={SummaryClasses.SummaryCarouselContainer}
 *                 leftMargin={32} edgeMask="none">
 *         {tiles}
 *       </Carousel>
 *     )}
 *   </Pageable>
 *
 * `bNoHeader`/`customheader` matter more than they look: passing `name`
 * alone (no `customheader`) renders `Pageable`'s OWN generic header instead
 * of native's real `GamePlaySummaryHeader`-classed one, and `bNoHeader=true`
 * suppresses the header ENTIRELY (customheader included) - see this file's
 * `Props.header` doc comment below for both wrong readings hit getting this
 * right, and knowledgebase.md for the full trace.
 *
 * `Pageable` owns the header row, the dismiss button, AND the pager arrows
 * (only rendering the arrow pair at all when the `Carousel` it wraps reports
 * overflow in at least one direction - confirmed live: native shows NO
 * arrows on a summary that fits one row, not a disabled pair). `Carousel` is
 * the actual scrolling primitive: `ResizeObserver`-backed overflow
 * detection, scroll-to-next/previous-not-fully-visible-child paging, and its
 * own scroll-position animation (never the browser's
 * `scrollTo({behavior:'smooth'})`, which the git history above found to be a
 * silent no-op in this Steam/CEF build).
 *
 * Resolved via `findModuleExport` (an official `@steambrew/client` API, not
 * a hand-rolled webpack walk) with a filter over each component's real
 * `prototype` method names - method names survive minification (only
 * variable/module bindings get shortened), unlike a raw numeric module id,
 * which is why this is stable across Steam builds the same way
 * `findClassModule`'s name-based class probing already is elsewhere in this
 * codebase. If either fails to resolve (a Steam update renames every method
 * or removes the component), `hasRealCarousel` is `false` and
 * `PostGameSummary` (activity.tsx) never renders `RealPostGameSummaryShell`
 * at all - it falls back to a hand-built header plus `PlainFallbackCarousel`
 * (a plain, pager-less scrolling row) instead of crashing the page.
 */

const RealPageable = findModuleExport(
  (m) =>
    typeof m === 'function' &&
    typeof m.prototype?.OnUpdateArrows === 'function' &&
    typeof m.prototype?.ScrollToFirstChild === 'function' &&
    typeof m.prototype?.onCloseButtonClicked === 'function',
);

const RealCarousel = findModuleExport(
  (m) =>
    typeof m === 'function' &&
    typeof m.prototype?.BindScrollingContainer === 'function' &&
    typeof m.prototype?.UpdateScrollArrows === 'function' &&
    typeof m.prototype?.ScheduleUpdateScrollArrows === 'function',
);

/** True once both real components resolved - callers use this to decide
 * whether to render the real shell or their own fallback. */
export const hasRealCarousel = Boolean(RealPageable && RealCarousel);

export interface ItemCarouselHandle {
  scrollLeft(): void;
  scrollRight(): void;
}

interface Props {
  /** Accessible name for the tile list - always "Post-Game Summary" here. */
  name: string;
  /**
   * The visible header content
   * (`<div className={SummaryClasses.GamePlaySummaryHeader}>Post-Game
   * Summary</div>`, decompiled from module `53074`), passed to `Pageable`'s
   * `customheader` prop with `bNoHeader={false}`.
   *
   * TWO WRONG READINGS of the same decompiled source, in order, before
   * landing on this one:
   *
   * 1. First pass: passed a plain `name` string and no `customheader`,
   *    which renders `Pageable`'s OWN generic `Name`+`Rule` header instead -
   *    confirmed wrong live (native's real header carries the
   *    `GamePlaySummaryHeader` class, never `Name`; the empty `Rule` div
   *    also doesn't exist in current Steam's CSS - a dead, tree-shaken
   *    class, same pattern as `ClipClasses`'s ambiguous-probe bug elsewhere
   *    in this file's sibling module).
   * 2. Second pass: read `!this.props.bNoHeader && <div
   *    className={HeaderPageControls}>...</div>` in `Pageable`'s OWN source
   *    and concluded `bNoHeader` gates the ENTIRE header div, `customheader`
   *    included - true, but then wrongly passed `bNoHeader={true}`
   *    unconditionally, which suppressed the header completely (confirmed
   *    live: no `HeaderPageControls` div rendered AT ALL, not even our
   *    custom one).
   *
   * The real caller (module `53074`) computes a LOCAL boolean `n` ("is this
   * a short/header-outside summary" - true only when every item is a
   * multi-achievement group, never true for screenshots/recordings) and
   * passes `bNoHeader={n}` + `customheader={p}` where `p` is the SAME
   * `GamePlaySummaryHeader` div either way - when `n` is true that div is
   * ALSO rendered as a sibling above `Pageable` instead of inside it.
   * `non-steam-games-activity`'s summaries are always screenshots/
   * recordings, never achievement-only, so `n` is always `false` here:
   * always `bNoHeader={false}`, always `customheader={header}`, and the
   * `n && header`-outside-Pageable case never applies.
   */
  header: ReactNode;
  onDismiss: () => void;
  children: ReactNode;
}

/**
 * Renders Steam's real `Pageable` wrapping its real `Carousel`, exactly as
 * native's own Post-Game Summary component does. `PostGameSummary`
 * (activity.tsx) is the only caller, and only when `hasRealCarousel` is true
 * - it owns the fallback path for when the real components did not resolve.
 */
export const RealPostGameSummaryShell = forwardRef<ItemCarouselHandle, Props>(
  function RealPostGameSummaryShell({ name, header, onDismiss, children }, ref) {
    const realCarouselRef = useRef<{
      ScrollLeft: (e: unknown) => void;
      ScrollRight: (e: unknown) => void;
    } | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        scrollLeft: () => realCarouselRef.current?.ScrollLeft({}),
        scrollRight: () => realCarouselRef.current?.ScrollRight({}),
      }),
      [],
    );

    // Real Pageable's `children` is a render-prop function:
    // (scrollRef, fnUpdateArrows) => <RealCarousel ref={scrollRef} .../>,
    // matching native's own real usage exactly (see the decompiled snippet
    // in this file's doc comment). Passed as an explicit `children` prop
    // (rather than createElement's third argument) because RealPageable's
    // actual runtime contract - a function, not a ReactNode - is not one
    // React's own JSX/createElement typings model; this whole file is
    // untyped interop with a component pulled from Steam's own module
    // cache, so the props object is typed loosely on purpose.
    const renderCarousel = (
      scrollRef: ((instance: unknown) => void) | { current: unknown },
      fnUpdateArrows: unknown,
    ) =>
      createElement(RealCarousel, {
        ref: (instance: typeof realCarouselRef.current) => {
          realCarouselRef.current = instance;
          if (typeof scrollRef === 'function') scrollRef(instance);
          else if (scrollRef) scrollRef.current = instance;
        },
        'aria-label': name,
        className: S.SummaryCarouselContainer,
        leftMargin: 32,
        fnUpdateArrows,
        edgeMask: 'none',
        children,
      });

    return createElement(RealPageable, {
      name,
      bNoHeader: false,
      customheader: header,
      bShowCloseButton: true,
      onCloseButtonClicked: onDismiss,
      buttonSize: 'small',
      headerPadding: '0px 8px 0px 0px',
      className: cx(P.PageableContainer, 'Panel'),
      children: renderCarousel,
    });
  },
);

/**
 * Minimal fallback used only if `hasRealCarousel` is false: a plain
 * scrolling row with buttons that jump by one viewport width, no arrows, no
 * header/dismiss (the caller still renders its own in that case). Degrades
 * the page to "scrolls, but not styled like native" rather than a crash -
 * the same fail-open spirit as `classModule` returning `{}` on a missed CSS
 * probe elsewhere in this codebase.
 */
export const PlainFallbackCarousel = forwardRef<ItemCarouselHandle, { children: ReactNode; ariaLabel?: string }>(
  function PlainFallbackCarousel({ children, ariaLabel }, ref) {
    const scrollerRef = useRef<HTMLDivElement | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        scrollLeft: () => {
          const scroller = scrollerRef.current;
          if (scroller) scroller.scrollLeft -= scroller.clientWidth;
        },
        scrollRight: () => {
          const scroller = scrollerRef.current;
          if (scroller) scroller.scrollLeft += scroller.clientWidth;
        },
      }),
      [],
    );

    return (
      <div
        ref={scrollerRef}
        role="list"
        aria-label={ariaLabel}
        style={{ display: 'flex', overflowX: 'auto', gap: '8px' }}
      >
        {children}
      </div>
    );
  },
);

// Re-exported so consumers checking a carousel child for "skip this in
// visibility math" (Steam's own `data-carousel="ignore"` convention) don't
// need their own copy of the check.
export function isIgnored(el: Element): boolean {
  return el.getAttribute('data-carousel') === 'ignore';
}
