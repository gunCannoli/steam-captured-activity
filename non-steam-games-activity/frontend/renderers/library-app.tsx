import { querySelectorAll, renderComponent } from 'steambrew-utils/dom';
import { logger } from '../logger';
import { ActivityPage } from '../components/activity';
import { rpc, type Activity, type TimelineEntry } from '../rpc';
import { ensureStyles } from '../styles';
import { loadFullImage } from '../assets';

/**
 * Injects the activity page into a non-Steam game's library page.
 *
 * Steam renders nothing but a grey "information is unavailable" placeholder for
 * these apps, so we render into the page body underneath the play bar.
 *
 * Everything we add carries `data-nsga`, so a re-render replaces our previous
 * nodes instead of stacking duplicates, and teardown can find them.
 */

const MARKER = 'data-nsga';

/** Windows currently showing an app page, so a quitting game can refresh them. */
const activeViews = new Map<Window, number>();

/**
 * Hide Steam's "information is unavailable because it is a non-Steam game"
 * box, which is the thing this plugin exists to replace.
 *
 * Done with a stylesheet rather than by removing the node: Steam owns that
 * element and re-renders it, and deleting a React-managed node invites
 * reconciliation errors. The rule is scoped to sections that contain the
 * placeholder, so Steam's other sections are untouched.
 */
function hidePlaceholder(doc: Document): void {
  const STYLE_ID = 'nsga-hide-placeholder';
  if (doc.getElementById(STYLE_ID)) return;

  // Find the section wrapping the placeholder text and tag it, so the CSS has
  // something precise to target. Text matching is the only reliable signal -
  // the box has no distinguishing class of its own.
  const sections = doc.querySelectorAll('[class*="AppDetailsSection"]');
  let tagged = false;
  for (const section of sections) {
    const text = section.textContent ?? '';
    if (text.includes('non-Steam game or mod')) {
      section.setAttribute(MARKER, 'placeholder');
      tagged = true;
    }
  }
  if (!tagged) return;

  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `[${MARKER}="placeholder"] { display: none !important; }`;
  doc.head.appendChild(style);
}

/** Remove anything we injected into this window. */
export function unpatch(window: Window): void {
  activeViews.delete(window);

  try {
    const doc = window.document;

    for (const node of doc.querySelectorAll(`[${MARKER}="root"]`)) {
      node.remove();
    }

    // Put Steam's own placeholder back: on a native game's page it is correct
    // for it to show, and disabling the plugin must leave no trace.
    doc.getElementById('nsga-hide-placeholder')?.remove();
    for (const node of doc.querySelectorAll(`[${MARKER}="placeholder"]`)) {
      node.removeAttribute(MARKER);
    }
  } catch {
    // The window may already be gone; nothing to clean up.
  }
}

/** Re-render any open page for this app (called when a game quits). */
export async function refresh(appid: number): Promise<void> {
  const targets = [...activeViews].filter(([, id]) => id === appid);
  await Promise.allSettled(targets.map(([window]) => patch(window, appid)));
}

/**
 * Open a capture at full size.
 *
 * Screenshots are fetched on demand - they average ~1 MB, so they are
 * deliberately not part of the page payload (ADR-0017). Recordings are
 * MPEG-DASH and cannot play in a plain <video> element, so v1 opens the
 * clip's folder rather than pretending to be a player.
 */
async function openEntry(window: Window, entry: TimelineEntry): Promise<void> {
  if (entry.type === 'recording') {
    logger.info('Recording selected (playback is not implemented yet)', entry.path);
    return;
  }

  const uri = await loadFullImage(entry.path);
  if (!uri) {
    logger.warn('Could not load full-size image', entry.path);
    return;
  }

  const view = window.open('', '_blank');
  if (!view) return;
  view.document.write(
    `<body style="margin:0;background:#0e141b;display:flex;align-items:center;justify-content:center;height:100vh">` +
      `<img src="${uri}" style="max-width:100%;max-height:100%">` +
      `</body>`,
  );
  view.document.close();
}

/**
 * Render the activity page for `appid` into `window`.
 *
 * Callers must only pass a non-Steam appid; the caller owns that check because
 * it also decides whether to unpatch.
 */
export async function patch(window: Window, appid: number): Promise<void> {
  // Drop any previous render first - this window may have shown another app.
  unpatch(window);
  activeViews.set(window, appid);

  let activity: Activity;
  try {
    activity = await rpc.getActivity(appid);
  } catch (error) {
    logger.error('Could not load activity for', appid, error);
    return;
  }

  // The page may have navigated away while we were waiting on the backend.
  if (activeViews.get(window) !== appid) return;

  // The left column of the details page is where Steam puts its "information is
  // unavailable" placeholder, so that is where the activity page belongs.
  //
  // These class names are CSS modules, so the DOM carries both the hashed name
  // and the readable one ("_1sZgBD… LeftColumn"). Matching the readable half
  // with an attribute selector avoids hardcoding a hash (ADR-0005) while still
  // being specific.
  const columns = await querySelectorAll(window.document, '[class*="LeftColumn"]');
  const anchor = columns[0];
  if (!anchor) {
    logger.warn('Could not find the details column; skipping render for', appid);
    return;
  }

  // Navigation may have happened while querySelectorAll was polling.
  if (activeViews.get(window) !== appid) return;

  ensureStyles(window.document);
  hidePlaceholder(window.document);

  const element = renderComponent(
    <ActivityPage activity={activity} onOpen={(entry) => void openEntry(window, entry)} />,
  );
  element.setAttribute(MARKER, 'root');
  // Above Steam's own sections, matching where the native page puts its
  // post-game summary.
  anchor.prepend(element);

  logger.info(
    `Rendered ${activity.timeline.length} day(s) for ${activity.name ?? appid}`,
  );
}
