import { logger } from '../logger';
import { appDetailsSections } from './stores';

/**
 * Re-enable the app detail sections Steam hides from non-Steam games.
 *
 * Steam builds its detail page from a section registry. For a shortcut it
 * swaps the full list for a three-item one:
 *
 *   BIsModOrShortcut() && (s = ["nonsteam", "notes", "screenshots"])
 *
 * `postgamesummary` and `activity` are dropped *before* render - not because
 * the data is missing, but because the registry filters on app type. Every
 * component and store behind them works fine with a shortcut's appid.
 *
 * So this is the whole fix: put the section names back. Steam renders the rest
 * (ADR-0009 - patch the data, not the DOM).
 *
 * See docs/steam-components.md for the full registry and how it was read.
 */

/** Sections we re-enable, and why each one is safe to show. */
const RESTORED_SECTIONS = [
  // Fed by us via the spotlight store; renders screenshots and clips.
  'postgamesummary',
] as const;

/**
 * Sections we remove once we have something better to show.
 *
 * `nonsteam` is Steam's grey "detailed information is unavailable because it is
 * a non-Steam game or mod" box - the exact thing this plugin exists to replace.
 *
 * Dropping it from the registry is how it *should* be removed: the previous
 * approach injected a stylesheet to `display: none` the rendered node, which
 * meant fighting Steam's re-renders and leaving a hidden element behind. Here
 * Steam simply never builds it.
 *
 * Only removed when we actually published a summary, so a game with no captures
 * still gets Steam's honest explanation rather than a blank page.
 */
const REPLACED_SECTIONS = ['nonsteam'] as const;

/** Apps for which we have content worth showing instead of the placeholder. */
const appsWithContent = new Set<number>();

/** Called whenever the set of apps-with-content changes. */
const contentListeners = new Set<() => void>();

/** Run `fn` whenever an app gains or loses content. Returns an unsubscribe. */
export function onContentChanged(fn: () => void): () => void {
  contentListeners.add(fn);
  return () => contentListeners.delete(fn);
}

/**
 * Tell the section registry this app has a summary (or no longer does).
 *
 * Notifies listeners only on an actual change, so the re-render this triggers
 * does not fire on every navigation.
 */
export function setHasContent(appid: number, hasContent: boolean): void {
  const had = appsWithContent.has(appid);
  if (had === hasContent) return;

  if (hasContent) appsWithContent.add(appid);
  else appsWithContent.delete(appid);

  // Steam has already rendered this page by the time a publish finishes, so
  // ask the live components to rebuild their section list.
  refreshInstances();

  for (const listener of contentListeners) {
    try {
      listener();
    } catch (error) {
      logger.warn('A content listener failed:', error);
    }
  }
}

interface AppOverview {
  BIsModOrShortcut?: () => boolean;
  appid?: number;
}

type GetSections = (overview: unknown, details: unknown) => Set<string>;

/** React component instance, as far as we need it. */
interface SectionsInstance {
  m_setSectionsMemo?: Set<string>;
  forceUpdate?: () => void;
}

let original: GetSections | undefined;
let patchedProto: { GetSections: GetSections } | undefined;

/**
 * Live instances of Steam's sections component.
 *
 * `GetSections` is called from `render()`, so every instance that renders a
 * page passes through our patch and registers itself here. Held weakly-ish: an
 * entry is dropped as soon as re-rendering it throws, which is what happens
 * once React has unmounted it.
 *
 * We need these because the summary is published *asynchronously*, after the
 * page has already rendered. The component is a MobX observer, but it observes
 * Steam's stores - not our set of apps-with-content - so nothing tells it to
 * re-run `GetSections` when we finish loading. Without a nudge the page keeps
 * the first render's section list, which still contains Steam's
 * "information is unavailable" placeholder. Verified live: the section set is
 * correct on a fresh call while the rendered page is stale.
 */
const instances = new Set<SectionsInstance>();

/** Re-render every live sections component. */
function refreshInstances(): void {
  for (const instance of [...instances]) {
    try {
      // Drop the memo first: Steam returns the cached set when the size
      // matches, and our change swaps one member for another.
      instance.m_setSectionsMemo = undefined;
      instance.forceUpdate?.();
    } catch {
      instances.delete(instance);
    }
  }
}

/** True when `overview` is a non-Steam shortcut. */
function isShortcut(overview: unknown): boolean {
  const fn = (overview as AppOverview | undefined)?.BIsModOrShortcut;
  try {
    return typeof fn === 'function' && fn.call(overview) === true;
  } catch {
    return false;
  }
}

/**
 * Patch the section registry.
 *
 * Idempotent, and a no-op if the component cannot be resolved - a Steam update
 * that moves it degrades the page to stock rather than crashing it.
 */
export function patchSections(): boolean {
  if (original) return true;

  const component = appDetailsSections();
  if (!component) return false;

  const proto = component.prototype as unknown as {
    GetSections: GetSections;
    m_setSectionsMemo?: Set<string>;
  };
  const base = proto.GetSections;
  if (typeof base !== 'function') return false;

  proto.GetSections = function patchedGetSections(
    this: SectionsInstance,
    overview: unknown,
    details: unknown,
  ): Set<string> {
    // Steam's own implementation RETURNS ITS MEMO, not the set it just built:
    //
    //   ... else this.m_setSectionsMemo = a;
    //   return this.m_setSectionsMemo;
    //
    // so the returned object is sometimes a cached set from an earlier call.
    // Mutating it in place is therefore the only reliable way to influence the
    // result - editing a local copy gets silently discarded on a memo hit,
    // which is exactly how an earlier version of this patch appeared to work
    // (the summary showed) while the placeholder removal never took effect.
    const sections = base.call(this, overview, details);

    if (!isShortcut(overview)) return sections;

    // Remember this instance so a later publish can re-render it.
    instances.add(this);

    try {
      for (const name of RESTORED_SECTIONS) sections.add(name);

      // Only hide Steam's placeholder once we actually have something in its
      // place; otherwise the page would just lose an explanation and gain
      // nothing.
      const appid = (overview as AppOverview | undefined)?.appid;
      if (appid !== undefined && appsWithContent.has(appid)) {
        for (const name of REPLACED_SECTIONS) sections.delete(name);
      }

      // Keep the memo pointing at the object we just edited, so a later call
      // that hits the cache sees our version.
      this.m_setSectionsMemo = sections;
    } catch (error) {
      logger.warn('Could not adjust the section list:', error);
    }

    return sections;
  };

  original = base;
  patchedProto = proto;
  logger.info(`Restored sections for non-Steam games: ${RESTORED_SECTIONS.join(', ')}`);
  return true;
}

/** Put Steam's own implementation back. Disabling the plugin leaves no trace. */
export function unpatchSections(): void {
  if (patchedProto && original) patchedProto.GetSections = original;
  original = undefined;
  patchedProto = undefined;

  appsWithContent.clear();
  refreshInstances();
  instances.clear();
  contentListeners.clear();
}
