import { logger } from '../logger';
import type { ConsolidatedMetadata } from '../rpc';

/**
 * Standard Steam Store Category IDs:
 * 1: Multi-player
 * 2: Single-player
 * 9: Co-op
 * 22: Steam Achievements
 * 24: Shared/Split Screen
 * 28: Full Controller Support
 * 37: Shared/Split Screen Co-op
 */
export const STEAM_CATEGORIES = {
  MULTIPLAYER: 1,
  SINGLE_PLAYER: 2,
  COOP: 9,
  ACHIEVEMENTS: 22,
  SPLIT_SCREEN: 24,
  FULL_CONTROLLER: 28,
  SPLIT_SCREEN_COOP: 37,
} as const;

function toArray<T>(val: unknown): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') return Object.values(val as Record<string, T>);
  return [];
}

/**
 * Enriches Steam's in-memory CAppDetailsStore and appStore (AppOverview)
 * so that Big Picture's "Game Info" tab and Desktop game panels display
 * descriptions, developers, publishers, franchises, release dates,
 * and category badges natively without custom UI injection.
 */
export function enrichGameDetails(appid: number, meta: ConsolidatedMetadata): boolean {
  try {
    let touched = false;

    const developers = toArray<string>(meta.developers);
    const publishers = toArray<string>(meta.publishers);
    const franchises = toArray<string>(meta.franchises);

    // 1. Populate appDetailsStore (Big Picture Game Info tab & details)
    const detailsStore = (window as any).appDetailsStore;
    if (detailsStore?.GetAppData) {
      const appData = detailsStore.GetAppData(appid);
      if (appData) {
        // Descriptions (snippet for sidebar/header, full for Game Info body)
        const summary = meta.summary || meta.description || '';
        const fullDesc = meta.description || meta.summary || '';
        appData.descriptionsData = {
          strSnippet: summary,
          strFullDescription: fullDesc,
        };

        // Associations (Developers, Publishers, Franchises)
        appData.associationData = {
          rgDevelopers: developers.map((name) => ({ strName: name, strURL: null })),
          rgPublishers: publishers.map((name) => ({ strName: name, strURL: null })),
          rgFranchises: franchises.map((name) => ({ strName: name, strURL: null })),
        };

        if (!appData.details) {
          appData.details = {};
        }
        if (developers.length > 0) {
          appData.details.strDeveloperName = developers[0];
        }

        // Notify mobx observers if available
        if (typeof detailsStore.AppDetailsChanged === 'function') {
          try {
            detailsStore.AppDetailsChanged(appid);
          } catch {}
        }
        touched = true;
      }
    }

    // 2. Populate appStore AppOverview (Categories, Game Modes, Controller Support, Release Date)
    const appStore = (window as any).appStore;
    if (appStore?.GetAppOverviewByAppID) {
      const overview = appStore.GetAppOverviewByAppID(appid);
      if (overview) {
        // Ensure m_setStoreCategories is an active Set
        if (!overview.m_setStoreCategories || typeof overview.m_setStoreCategories.add !== 'function') {
          overview.m_setStoreCategories = new Set<number>();
        }

        const cats = meta.categories || {};
        if (cats.single_player) overview.m_setStoreCategories.add(STEAM_CATEGORIES.SINGLE_PLAYER);
        if (cats.multiplayer) overview.m_setStoreCategories.add(STEAM_CATEGORIES.MULTIPLAYER);
        if (cats.coop) overview.m_setStoreCategories.add(STEAM_CATEGORIES.COOP);
        if (cats.split_screen) {
          overview.m_setStoreCategories.add(STEAM_CATEGORIES.SPLIT_SCREEN);
          if (cats.coop) overview.m_setStoreCategories.add(STEAM_CATEGORIES.SPLIT_SCREEN_COOP);
        }
        if (cats.full_controller !== false) {
          overview.m_setStoreCategories.add(STEAM_CATEGORIES.FULL_CONTROLLER);
        }
        if (cats.achievements) {
          overview.m_setStoreCategories.add(STEAM_CATEGORIES.ACHIEVEMENTS);
        }

        // Release Date
        if (meta.release_date && meta.release_date > 0) {
          overview.rt_original_release_date = meta.release_date;
          overview.rt_steam_release_date = meta.release_date;
        }

        touched = true;
      }
    }

    if (touched) {
      logger.info(
        `Enriched native Game Info & Categories for ${appid} ("${meta.title}"): ` +
          `[Dev: ${(meta.developers || []).join(', ') || 'none'}, ` +
          `Franchise: ${(meta.franchises || []).join(', ') || 'none'}, ` +
          `Modes: ${meta.categories?.single_player ? 'Single ' : ''}${meta.categories?.multiplayer ? 'Multi ' : ''}${meta.categories?.coop ? 'Co-op ' : ''}]`,
      );
    }
    return touched;
  } catch (err) {
    logger.warn(`Could not enrich native Game Info for ${appid}:`, err);
    return false;
  }
}
