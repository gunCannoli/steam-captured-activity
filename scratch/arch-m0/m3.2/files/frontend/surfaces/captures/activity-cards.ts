import React from 'react';
import { findModuleByExport } from '@steambrew/client';
import { keepJsxPatched, type JsxHookDiagnostics } from '../../steam/jsx-hook';
import { logger } from '../../logger';
import type { MediaItem } from './activity';
import { deps } from './deps';

interface JsxRuntimeModule {
  jsx(type: unknown, props: unknown, key?: unknown): unknown;
  jsxs(type: unknown, props: unknown, key?: unknown): unknown;
}

interface WebpackRequire {
  (id: string): any;
  m: Record<string, any>;
}

type ChunkGlobal = Array<
  [string[], Record<string, unknown>, ((r: WebpackRequire) => void)?]
>;

let cachedRequire: WebpackRequire | undefined;

function getSteamRequire(): WebpackRequire | undefined {
  if (cachedRequire) return cachedRequire;
  try {
    const chunks = (window as any).webpackChunksteamui as ChunkGlobal | undefined;
    if (!Array.isArray(chunks)) return undefined;

    const key = `__nsga_card_probe_${Date.now()}`;
    let captured: WebpackRequire | undefined;

    chunks.push([
      [key],
      {
        [key]: (_m: unknown, _e: unknown, r: WebpackRequire) => {
          captured = r;
        },
      },
      (r: any) => {
        r((r.s = key));
      },
    ]);

    cachedRequire = captured;
  } catch (err) {
    logger.warn('Could not capture Steam module require for activity cards:', err);
  }
  return cachedRequire;
}

let hasScanned = false;
let cachedClipComponent: any = undefined;
let cachedScreenshotComponent: any = undefined;
let cachedScreenshotAdapter: any = undefined;
let cachedSummaryClasses: Record<string, string> = {};

function initCardComponents(): void {
  if (hasScanned) return;
  hasScanned = true;

  const req = getSteamRequire();
  if (!req?.m) return;

  for (const id of Object.keys(req.m)) {
    try {
      const factory = req.m[id];
      if (!factory) continue;
      const src = typeof factory === 'function' ? factory.toString() : '';
      if (!src) continue;

      if (!cachedClipComponent && src.includes('Media.Clip') && src.includes('thumbnail_width')) {
        const exp = req(id);
        for (const k of Object.keys(exp || {})) {
          if (typeof exp[k] === 'function' && exp[k].toString().includes('Media.Clip')) {
            cachedClipComponent = exp[k];
            break;
          }
        }
      }

      if (!cachedScreenshotComponent && src.includes('ClickableScreenshot') && src.includes('sizeAxis')) {
        const exp = req(id);
        for (const k of Object.keys(exp || {})) {
          if (typeof exp[k] === 'function' && exp[k].toString().includes('sizeAxis')) {
            cachedScreenshotComponent = exp[k];
            break;
          }
        }
      }

      if (!cachedScreenshotAdapter && src.includes('strShortcutName') && src.includes('rtCreated') && src.includes('bUploaded')) {
        const exp = req(id);
        for (const k of Object.keys(exp || {})) {
          if (typeof exp[k] === 'function' && exp[k].toString().includes('strShortcutName')) {
            cachedScreenshotAdapter = exp[k];
            break;
          }
        }
      }

      if (!cachedSummaryClasses.SummaryContainer && src.includes('SummaryContainerChildren') && src.includes('SummaryScreenshot')) {
        const exp = req(id);
        if (exp?.SummaryContainer && exp?.SummaryContainerChildren) {
          cachedSummaryClasses = exp;
        }
      }

      if (
        cachedClipComponent &&
        cachedScreenshotComponent &&
        cachedScreenshotAdapter &&
        cachedSummaryClasses.SummaryContainer
      ) {
        break;
      }
    } catch {}
  }
}

/**
 * Native-style Post-Game Summary cards container rendered inside each Activity Feed day.
 */
function NonSteamActivityCards(props: { event: any }): React.ReactElement | null {
  const items = props.event?.m_mediaItems as MediaItem[] | undefined;
  if (!items || items.length === 0) return null;

  initCardComponents();

  const PostGameSummaryClip = cachedClipComponent;
  const SummaryScreenshot = cachedScreenshotComponent;
  const adapterBo = cachedScreenshotAdapter;
  const s = cachedSummaryClasses;

  const renderedCards = items.map((item) => {
    let content: React.ReactNode = null;
    if (item.isClip && item.rawClip && PostGameSummaryClip) {
      content = React.createElement(PostGameSummaryClip, { clip: item.rawClip });
    } else if (!item.isClip && item.rawScreenshot && SummaryScreenshot && adapterBo) {
      content = React.createElement(SummaryScreenshot, {
        screenshot: adapterBo(item.rawScreenshot),
        sizeAxis: 'height',
        className: s.SummaryScreenshot || '',
      });
    } else {
      content = React.createElement('img', {
        src: item.url,
        alt: item.caption,
        style: { width: '100%', height: '100%', objectFit: 'cover' },
      });
    }

    return React.createElement(
      'div',
      {
        key: item.id,
        role: 'listitem',
        className: `${s.SummaryContainer || 'SummaryContainer'} ${s.NoAnimation || 'NoAnimation'}`,
        style: {
          width: '224px',
          height: '126px',
          flex: '0 0 224px',
          position: 'relative',
        },
      },
      React.createElement(
        'div',
        {
          className: s.SummaryContainerChildren || 'SummaryContainerChildren',
          style: {
            width: '224px',
            height: '126px',
            position: 'relative',
            overflow: 'hidden',
            borderRadius: '4px',
          },
        },
        content,
      ),
    );
  });

  return React.createElement(
    'div',
    {
      'flow-children': 'row',
      className: 'NonSteamActivityCardsRow CarouselThumbs',
      style: {
        display: 'flex',
        flexDirection: 'row',
        gap: '16px',
        overflowX: 'auto',
        overflowY: 'hidden',
        padding: '8px 0',
        width: '100%',
        maxWidth: '100%',
      },
    },
    renderedCards,
  );
}

function findJsxRuntime(): JsxRuntimeModule | undefined {
  const found = findModuleByExport(
    (moduleExport: unknown, exportName?: unknown) =>
      (exportName === 'jsx' || exportName === 'jsxs') && typeof moduleExport === 'function',
  ) as JsxRuntimeModule | undefined;

  if (!found || typeof found.jsx !== 'function' || typeof found.jsxs !== 'function') return undefined;
  return found;
}

let hook: ReturnType<typeof keepJsxPatched> | undefined;

function handleActivityCardReplace(_type: unknown, props: unknown): unknown {
  const p = props as any;
  if (
    p?.event?.bIsNonSteam &&
    Array.isArray(p.event.m_mediaItems) &&
    p.onScreenshotChanged
  ) {
    return NonSteamActivityCards;
  }
  return undefined;
}

/**
 * Install the Activity Cards patch to replace Steam's community screenshot carousel
 * with genuine Post-Game Summary cards (PostGameSummaryClip and SummaryScreenshot)
 * for non-Steam games. Self-healing and shared safely with the other plugins that hook
 * jsx (steam/jsx-hook.ts).
 */
export function installActivityCardsPatch(): void {
  if (hook) return;

  const runtime = findJsxRuntime();
  if (!runtime) {
    logger.warn('Could not find react/jsx-runtime; activity cards patch skipped.');
    return;
  }

  initCardComponents();

  hook = keepJsxPatched(runtime as unknown as Record<'jsx' | 'jsxs', (type: unknown, props: unknown, key?: unknown) => unknown>, {
    label: 'steam-cartridges.activity-cards',
    replaceType: (type, props) => {
      if (!deps.isEnabled('activity-cards')) return undefined;
      try {
        return handleActivityCardReplace(type, props);
      } catch (err) {
        deps.reportError('activity-cards', err); // fail-open (plan § 7.0 D6)
        return undefined;
      }
    },
  });
  logger.info('Installed Activity Feed native Post-Game Summary cards patch.');
}

/** Chain health, for tests (window.PLUGIN_LIST[...].activityCardsJsxDiagnostics()). */
export function activityCardsJsxDiagnostics(): JsxHookDiagnostics[] {
  return hook?.diagnostics() ?? [];
}
