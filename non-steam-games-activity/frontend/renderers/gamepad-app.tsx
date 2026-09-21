import { Steam } from 'steambrew-utils';
import { renderComponent } from 'steambrew-utils/dom';
import { logger } from '../logger';
import { gameIdFromAppId } from '../steam/gameid';
import { resolveClassMap } from '../steam/modules';
import { clipsSince, screenshotsSince, type SteamClip, type SteamScreenshot } from '../steam/stores';

/**
 * Brings the Post-Game Summary to Big Picture — the one place in this plugin
 * that *does* build markup, and the reason is architectural, not a relapse to
 * the pre-ADR-0022 approach.
 *
 * Big Picture runs in its own webpack bundle with its own module cache
 * (`window.webpackChunksteamui` is `undefined` inside it — confirmed live) and
 * its own React tree. `steam/sections.ts` and `steam/summary.ts` patch
 * `CAppDetailsSections`/`CAppSpotlightStore` *instances that live in
 * SharedJSContext's bundle*; Big Picture's copies of those classes are
 * separate compiled objects, unreachable from here no matter what handle we
 * hold on the popup window. Steam's own component cannot be fed from outside
 * its own bundle. See ADR-0024.
 *
 * What *is* reachable: the popup's raw `Window`/`document`, via
 * `SteamClient`'s own `PopupManager` (confirmed live: `g_PopupManager` on
 * `SharedJSContext`'s `window`, the same global `steambrew-utils` wraps as
 * `Steam.PopupManager`). A DOM node created in `SharedJSContext` can be
 * `appendChild`-ed straight into that other document — same-process,
 * same-origin, no CDP involved. This is exactly the reference plugin's
 * (k0d13/steam-non-steam-playtimes) technique for making playtime show up in
 * Big Picture, and why it works there but our store-feeding approach does not.
 *
 * So: rung 4 of the reuse ladder (AGENTS.md) — clone Steam's DOM shape, using
 * class names resolved from *our* bundle (CSS is one build-wide stylesheet,
 * so a hash resolved in SharedJSContext is valid in the popup's document too;
 * only the *module cache* is bundle-local, not the compiled CSS). Kept as
 * small and skippable as possible: one horizontally-scrolling strip of tiles,
 * no carousel machinery, no day grouping. A resolution failure degrades to
 * unstyled-but-present markup rather than crashing (AGENTS.md's fallback
 * rule); a total failure (no captures, or the tab structure moves) renders
 * nothing, same as today.
 */

const MARKER = 'data-nsga-gamepad';

/**
 * Steam's real Post-Game Summary classes, resolved once. Probe keys are the
 * ones documented in steam-components.md's "Class keys (module 68854)" list.
 */
function summaryClasses(): Record<string, string> {
  return resolveClassMap('GamePlaySummaryContainer') ?? {};
}

function cx(...names: (string | undefined | false)[]): string {
  return names.filter(Boolean).join(' ');
}

interface SummaryTile {
  key: string;
  at: number;
  kind: 'screenshot' | 'clip';
  imageUrl: string;
  durationMs?: number;
}

function toTiles(screenshots: SteamScreenshot[], clips: SteamClip[]): SummaryTile[] {
  const shotTiles: SummaryTile[] = screenshots.map((s) => ({
    key: `shot_${s.hHandle}`,
    at: s.nCreated,
    kind: 'screenshot',
    imageUrl: s.strUrl,
  }));

  const clipTiles: SummaryTile[] = clips.map((c) => ({
    key: `clip_${c.clip_id}`,
    at: c.date_clipped,
    kind: 'clip',
    imageUrl: c.thumbnail_url,
    durationMs: Number(c.duration_ms) || 0,
  }));

  // Newest first, matching Steam's own summary carousel.
  return [...shotTiles, ...clipTiles].sort((a, b) => b.at - a.at);
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function Tile({ tile, cls }: { tile: SummaryTile; cls: Record<string, string> }) {
  return (
    <div
      className={cx(cls.SummaryContainer, 'NSGA_GamepadTile')}
      style={{
        display: 'inline-block',
        width: '200px',
        height: '112px',
        marginRight: '8px',
        borderRadius: '4px',
        overflow: 'hidden',
        position: 'relative',
        verticalAlign: 'top',
        backgroundColor: '#000',
        backgroundImage: `url("${tile.imageUrl}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {tile.kind === 'clip' && (
        <div
          style={{
            position: 'absolute',
            right: '4px',
            bottom: '4px',
            fontSize: '11px',
            color: '#fff',
            background: 'rgba(0,0,0,0.6)',
            padding: '1px 5px',
            borderRadius: '2px',
          }}
        >
          {formatDuration(tile.durationMs ?? 0)}
        </div>
      )}
    </div>
  );
}

function SummaryStrip({ tiles }: { tiles: SummaryTile[] }) {
  const cls = summaryClasses();

  return (
    <div data-nsga={MARKER} className={cx(cls.GamePlaySummaryContainer, 'NSGA_GamepadSummary')}>
      <div
        className={cx(cls.GamePlaySummaryHeader)}
        style={{
          fontSize: '14px',
          letterSpacing: '1px',
          textTransform: 'uppercase',
          color: 'rgb(148, 161, 166)',
          marginBottom: '10px',
        }}
      >
        {Steam.LocalizationManager?.LocalizeString?.('#AppSpotlight_PostGameSummary') ?? 'Post-Game Summary'}
      </div>
      <div style={{ whiteSpace: 'nowrap', overflowX: 'auto' }}>
        {tiles.map((tile) => (
          <Tile key={tile.key} tile={tile} cls={cls} />
        ))}
      </div>
    </div>
  );
}

/** Windows currently showing a patched app, so a quitting game can refresh them. */
const activeViews = new Map<Window, number>();

/** Remove anything we injected into this Big Picture window. */
export function unpatch(window: Window): void {
  activeViews.delete(window);
  try {
    for (const node of window.document.querySelectorAll(`[${MARKER}]`)) node.remove();
  } catch {
    // The window may already be gone.
  }
}

/** Re-render for this app in any Big Picture window currently showing it. */
export async function refresh(appid: number): Promise<void> {
  const targets = [...activeViews].filter(([, id]) => id === appid);
  await Promise.allSettled(targets.map(([window]) => patch(window, appid)));
}

/**
 * Render the summary strip into `window`'s ACTIVITY tab content area.
 *
 * `window` is the Big Picture popup's own `Window` (from
 * `Steam.PopupManager`/`onPopupCreate`), not the caller's. Callers must only
 * pass a non-Steam appid.
 */
export async function patch(window: Window, appid: number): Promise<void> {
  unpatch(window);
  activeViews.set(window, appid);

  const gameid = gameIdFromAppId(appid);
  let screenshots: SteamScreenshot[] = [];
  let clips: SteamClip[] = [];
  try {
    [screenshots, clips] = await Promise.all([screenshotsSince(appid, 0), clipsSince(gameid, 0)]);
  } catch (error) {
    logger.warn('Could not load captures for the Big Picture summary:', error);
    return;
  }

  // The window may have navigated away while we awaited.
  if (activeViews.get(window) !== appid) return;

  const tiles = toTiles(screenshots, clips);
  if (tiles.length === 0) return;

  // The ACTIVITY tab's content wrapper. Its own class is dynamic and
  // unresolved on purpose (it carries no useful probe key of its own); we
  // anchor on the tab strip instead, which we know is present because we can
  // already see "ACTIVITY"/"YOUR STUFF"/"GAME INFO" text there live.
  let anchor: Element | null = null;
  try {
    const tabStrip = [...window.document.querySelectorAll('*')].find(
      (el) => el.childElementCount === 0 && el.textContent?.trim() === 'ACTIVITY',
    );
    anchor = tabStrip?.closest('[class]')?.parentElement ?? null;
  } catch (error) {
    logger.warn('Could not find the Big Picture activity tab:', error);
    return;
  }

  if (!anchor) {
    logger.warn('Could not find an anchor for the Big Picture summary; skipping.');
    return;
  }

  const element = renderComponent(<SummaryStrip tiles={tiles} />);
  element.setAttribute(MARKER, 'root');
  anchor.appendChild(element);

  logger.info(`Rendered ${tiles.length} Big Picture summary tile(s) for ${appid}.`);
}
