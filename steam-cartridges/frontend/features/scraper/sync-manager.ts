import { useState, useEffect } from 'react';
import { rpc } from '../../rpc';
import { listShortcuts, listCollections, membersOf } from '../buckets';
import { getAutoRoutingProfile, loadAutoRoutingProfiles } from '../buckets/auto-routing';
import { isServiceAllowed } from '../buckets/resolve';
import { setting } from '../../settings/settings';
import { getLocalAchievements } from '../achievements';
import { logger } from '../../logger';

export interface SyncProgress {
    isSyncing: boolean;
    total: number;
    current: number;
    currentGame: string;
    phase: 'idle' | 'scraping' | 'complete';
}

let currentProgress: SyncProgress = {
    isSyncing: false,
    total: 0,
    current: 0,
    currentGame: '',
    phase: 'idle',
};

const listeners = new Set<(p: SyncProgress) => void>();

function setProgress(update: Partial<SyncProgress>) {
    currentProgress = { ...currentProgress, ...update };
    for (const listener of listeners) {
        try {
            listener(currentProgress);
        } catch (e) {
            logger.warn('SyncProgress listener threw:', e);
        }
    }
}

export function getSyncProgress(): SyncProgress {
    return currentProgress;
}

export function onSyncProgress(fn: (p: SyncProgress) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function useSyncProgress(): SyncProgress {
    const [progress, setLocalProgress] = useState(getSyncProgress);
    useEffect(() => {
        return onSyncProgress(setLocalProgress);
    }, []);
    return progress;
}

interface SyncItem {
    appid: number;
    name: string;
    needsMetadata: boolean;
    needsStore: boolean;
    needsAchievements: boolean;
}

let isRunning = false;
let pendingRerun = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Evaluates library shortcuts against current settings/rules and scrapes/mirrors
 * any missing data in the background.
 */
export async function startSync(options?: { forceAll?: boolean; onlyAppids?: number[] }): Promise<void> {
    if (isRunning) {
        pendingRerun = true;
        return;
    }
    isRunning = true;
    pendingRerun = false;

    try {
        await loadAutoRoutingProfiles();

        const shortcuts = listShortcuts();
        if (!shortcuts || shortcuts.length === 0) {
            isRunning = false;
            return;
        }

        const [metaRes, storeRes] = await Promise.all([
            rpc.getAllMetadata().catch(() => ({ success: false, library: {} })),
            rpc.steamStoreGetState().catch(() => null),
        ]);
        const metadataLib: Record<string, unknown> =
            metaRes && "library" in metaRes && metaRes.library
                ? (metaRes.library as Record<string, unknown>)
                : {};
        const storeMappings: Record<string, unknown> = storeRes?.mappings || {};

        const autoMode = setting('autoRoutingMode');
        const rules = setting('routingRules');
        const services = setting('services');

        const collMap: Record<number, string[]> = {};
        for (const c of listCollections()) {
            const mem = membersOf(c.id);
            if (mem) {
                for (const id of mem) {
                    if (!collMap[id]) collMap[id] = [];
                    collMap[id].push(c.name);
                }
            }
        }

        const targetAppids = options?.onlyAppids ? new Set(options.onlyAppids) : null;
        const itemsToSync: SyncItem[] = [];

        for (const sc of shortcuts) {
            if (targetAppids && !targetAppids.has(sc.appid)) continue;

            const collNames = collMap[sc.appid] || [];
            const profile = getAutoRoutingProfile(sc.appid);

            // Is game allowed by routing rules or auto mode?
            const isAllowed = isServiceAllowed(
                'all',
                sc.appid,
                sc.name,
                collNames,
                rules,
                autoMode,
                profile,
            );
            if (!isAllowed) continue;

            const igdbAllowed =
                services.igdbEnabled !== false &&
                isServiceAllowed('igdb', sc.appid, sc.name, collNames, rules, autoMode, profile);

            const screenscraperAllowed =
                services.screenscraperEnabled !== false &&
                isServiceAllowed('screenscraper', sc.appid, sc.name, collNames, rules, autoMode, profile);

            const steamStoreAllowed =
                services.steamStoreEnabled !== false &&
                isServiceAllowed('steam_store', sc.appid, sc.name, collNames, rules, autoMode, profile);

            const retroachievementsAllowed =
                services.retroachievementsEnabled !== false &&
                isServiceAllowed('retroachievements', sc.appid, sc.name, collNames, rules, autoMode, profile);

            const consoleEmuAllowed =
                services.emulatorsEnabled !== false &&
                isServiceAllowed('console_emulators', sc.appid, sc.name, collNames, rules, autoMode, profile);

            // Check metadata
            const existingMeta = metadataLib[String(sc.appid)];
            const needsMetadata = Boolean((igdbAllowed || screenscraperAllowed) && (!existingMeta || options?.forceAll));

            // Check Steam Store mapping
            const existingStoreMapping = storeMappings[String(sc.appid)];
            const needsStore = Boolean(steamStoreAllowed && (!existingStoreMapping || options?.forceAll));

            // Check Achievements
            const existingAchievements = getLocalAchievements(sc.appid);
            const needsAchievements = Boolean(
                (retroachievementsAllowed || consoleEmuAllowed) &&
                (!existingAchievements || existingAchievements.nTotal === 0 || options?.forceAll)
            );

            if (needsMetadata || needsStore || needsAchievements) {
                itemsToSync.push({
                    appid: sc.appid,
                    name: sc.name,
                    needsMetadata,
                    needsStore,
                    needsAchievements,
                });
            }
        }

        if (itemsToSync.length === 0) {
            setProgress({ isSyncing: false, phase: 'idle', total: 0, current: 0 });
            isRunning = false;
            return;
        }

        logger.info(`Starting background scrape/mirror for ${itemsToSync.length} shortcut(s)...`);
        setProgress({
            isSyncing: true,
            total: itemsToSync.length,
            current: 0,
            currentGame: itemsToSync[0]?.name || '',
            phase: 'scraping',
        });

        const batchSize = 2;
        for (let i = 0; i < itemsToSync.length; i += batchSize) {
            const batch = itemsToSync.slice(i, i + batchSize);
            await Promise.all(
                batch.map(async (item) => {
                    setProgress({ currentGame: item.name });
                    const tasks: Promise<unknown>[] = [];

                    if (item.needsMetadata) {
                        tasks.push(rpc.refreshGameMetadata(item.appid, item.name).catch(() => {}));
                    }
                    if (item.needsStore) {
                        tasks.push(rpc.steamStoreSearch(item.appid, item.name).catch(() => {}));
                    }
                    if (item.needsAchievements) {
                        tasks.push(rpc.cartridgesAchievementsGet(item.appid, 0).catch(() => {}));
                    }

                    await Promise.all(tasks);
                }),
            );

            const nextCount = Math.min(i + batchSize, itemsToSync.length);
            setProgress({
                current: nextCount,
                currentGame: itemsToSync[nextCount - 1]?.name || '',
            });

            // Periodically refresh the UI audit counts
            if (nextCount % 4 === 0 || nextCount === itemsToSync.length) {
                window.dispatchEvent(new CustomEvent('steam-cartridges:rule-updated'));
            }

            // Small throttle between batches to keep Steam client responsive
            await new Promise((resolve) => setTimeout(resolve, 200));
        }

        setProgress({
            isSyncing: false,
            current: itemsToSync.length,
            phase: 'complete',
        });
        window.dispatchEvent(new CustomEvent('steam-cartridges:rule-updated'));

        // Reset phase to idle after a few seconds
        setTimeout(() => {
            if (!isRunning) {
                setProgress({ phase: 'idle' });
            }
        }, 5000);
    } catch (e) {
        logger.error('Background sync failed:', e);
        setProgress({ isSyncing: false, phase: 'idle' });
    } finally {
        isRunning = false;
        if (pendingRerun) {
            pendingRerun = false;
            setTimeout(() => {
                void startSync();
            }, 300);
        }
    }
}

/**
 * Debounced trigger to queue a background sync whenever settings or rules change.
 */
export function triggerSync(delayMs = 350): void {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void startSync();
    }, delayMs);
}
