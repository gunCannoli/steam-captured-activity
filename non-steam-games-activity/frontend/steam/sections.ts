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
 * the data is missing, but because the registry filters on app type.
 *
 * For `postgamesummary` that is the whole fix: put the name back, feed Steam's
 * store, and Steam renders the rest (ADR-0009 - patch the data, not the DOM).
 *
 * `activity` is a different story, and the constant below explains why: its
 * components hit a *store* record a non-Steam game does not have, so the
 * section renders headings with empty bodies. Restoring a section is only
 * worth doing when what comes back is actually renderable - check, do not
 * assume the filter is the only obstacle.
 *
 * See docs/steam-components.md for the full registry and how it was read.
 */

/**
 * Sections we re-enable, and why each one is safe to show.
 *
 * **`activity` is deliberately NOT here.** Restoring it does produce Steam's
 * real ACTIVITY section, with correct day headings ("Yesterday", "Oct 24,
 * 2025") - but every event inside it renders as nothing, whatever its type.
 * Steam's event renderer opens with:
 *
 *   if (appid && (!storeApp || !storeApp.BIsVisible())) return null;
 *
 * where `storeApp` is a **store** record fetched with `k_DataRequest_Assets`.
 * A non-Steam game has none (verified live: `GetApp(4263274102)` returns
 * nothing, while a native appid returns a visible record), so the guard fires
 * for every event and the feed renders a heading with an empty body.
 *
 * That is not something feeding the store can fix - it is upstream of the
 * event data entirely. Enabling `activity` would trade one empty region for
 * another, so it stays off until there is a way through that guard.
 *
 * The Post-Game Summary already covers multiple days ("Today", "Yesterday",
 * "Oct 24, 2025"), which is most of what the feed would have shown.
 */
const RESTORED_SECTIONS = [
  // Fed by us via the spotlight store; renders screenshots and clips.
  'postgamesummary',
  // Fed by us via appActivityStore; renders chronological per-day activity cards.
  'activity',
] as const;

/**
 * Sections we remove once we have something better to show.
 *
 * `nonsteam` is Steam's grey "detailed information is unavailable because it is
 * a non-Steam game or mod" box. Now that `activity` and `postgamesummary` fill
 * `LeftColumn`, dropping `nonsteam` for games with content (`appsWithContent.has(appid)`)
 * produces a clean, fully native app details page without the disclaimer.
 *
 * When an app has NO captures or content, `nonsteam` is kept so the user still
 * sees Steam's accurate explanation rather than an awkward blank void.
 */
const REPLACED_SECTIONS: readonly string[] = ['nonsteam'];

/** Apps for which we have content worth showing instead of the placeholder. */
const appsWithContent = new Set<number>();

/**
 * Tell the section registry this app gained or lost a summary.
 *
 * The publish is async, so Steam has already rendered the page by the time it
 * finishes. The component is a MobX observer of Steam's stores, not of ours,
 * so nothing would otherwise tell it to re-run `GetSections` and pick up the
 * section we added. Only fires on an actual change, so navigation alone does
 * not force re-renders.
 */
export function setHasContent(appid: number, hasContent: boolean): void {
  const had = appsWithContent.has(appid);
  if (had === hasContent) return;

  if (hasContent) appsWithContent.add(appid);
  else appsWithContent.delete(appid);

  refreshInstances();
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

      // Only drop a section once we have something in its place; otherwise the
      // page loses an explanation and gains nothing. Empty today - see
      // REPLACED_SECTIONS.
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
}
