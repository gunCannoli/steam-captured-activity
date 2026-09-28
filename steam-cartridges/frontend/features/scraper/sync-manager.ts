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

const SYNC_HISTORY_KEY = 'steam_cartridges_sync_history_v1';
const COOLDOWN_NEGATIVE_MS = 24 * 60 * 60 * 1000; // 24 hours negative cache
const COOLDOWN_POSITIVE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days if data exists
const MIN_FULL_SCAN_INTERVAL_MS = 15 * 60 * 1000; // At most 1 full library background scan per 15 minutes
const MAX_BATCH_ITEMS = 100; // Cap per background run to support large libraries

interface SyncHistoryEntry {
    checkedAt: number;
    hasMetadata?: boolean;
    hasStore?: boolean;
    hasAchievements?: boolean;
}

let lastFullScanTimestamp = 0;
let circuitBreakerUntil = 0;

function loadSyncHistory(): Record<string, SyncHistoryEntry> {
    try {
        const raw = window.localStorage?.getItem(SYNC_HISTORY_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function saveSyncHistory(history: Record<string, SyncHistoryEntry>) {
    try {
        window.localStorage?.setItem(SYNC_HISTORY_KEY, JSON.stringify(history));
    } catch {
        // ignore
    }
}

let isRunning = false;
let pendingRerun = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const checkedAchievements = new Set<number>();
const checkedStore = new Set<number>();

/**
 * Evaluates library shortcuts against current settings/rules and scrapes/mirrors
 * any missing data in the background.
 */
export async function startSync(options?: { forceAll?: boolean; onlyAppids?: number[] }): Promise<void> {
    if (isRunning) {
        pendingRerun = true;
        return;
    }

    const now = Date.now();
    // Circuit breaker check
    if (!options?.forceAll && now < circuitBreakerUntil) {
        logger.info('[Sync] Scraper in cooldown after previous rate limit or errors.');
        setProgress({ isSyncing: false, phase: 'idle' });
        return;
    }

    // Full library scan interval check
    if (!options?.forceAll && !options?.onlyAppids) {
        if (now - lastFullScanTimestamp < MIN_FULL_SCAN_INTERVAL_MS) {
            logger.info('[Sync] Skipping full library scan: completed recently.');
            setProgress({ isSyncing: false, phase: 'idle' });
            return;
        }
        lastFullScanTimestamp = now;
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
        const syncHistory = loadSyncHistory();

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

            const hist = syncHistory[String(sc.appid)] || syncHistory[String(sc.appid >>> 0)];
            const timeSinceCheck = hist ? now - hist.checkedAt : Infinity;

            // If checked within 24h negative cache window and not forcing, skip
            if (!options?.forceAll && hist && timeSinceCheck < COOLDOWN_NEGATIVE_MS) {
                continue;
            }

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
            const existingMeta =
                metadataLib[String(sc.appid)] ||
                metadataLib[String(sc.appid >>> 0)] ||
                metadataLib[String(sc.appid | 0)];
            const needsMetadata = Boolean(
                (igdbAllowed || screenscraperAllowed) &&
                (!existingMeta || options?.forceAll) &&
                (!hist?.hasMetadata || timeSinceCheck >= COOLDOWN_POSITIVE_MS)
            );

            // Check Steam Store mapping
            const existingStoreMapping =
                storeMappings[String(sc.appid)] ||
                storeMappings[String(sc.appid >>> 0)] ||
                storeMappings[String(sc.appid | 0)];
            const alreadyCheckedStore =
                checkedStore.has(sc.appid) ||
                checkedStore.has(sc.appid >>> 0) ||
                checkedStore.has(sc.appid | 0);
            const needsStore = Boolean(
                steamStoreAllowed &&
                !alreadyCheckedStore &&
                (!existingStoreMapping || options?.forceAll) &&
                (!hist?.hasStore || timeSinceCheck >= COOLDOWN_POSITIVE_MS)
            );

            // Check Achievements
            const existingAchievements =
                getLocalAchievements(sc.appid) ||
                getLocalAchievements(sc.appid >>> 0) ||
                getLocalAchievements(sc.appid | 0);
            const alreadyCheckedAchievements =
                checkedAchievements.has(sc.appid) ||
                checkedAchievements.has(sc.appid >>> 0) ||
                checkedAchievements.has(sc.appid | 0);
            const needsAchievements = Boolean(
                (retroachievementsAllowed || consoleEmuAllowed) &&
                !alreadyCheckedAchievements &&
                (!existingAchievements || options?.forceAll) &&
                (!hist?.hasAchievements || timeSinceCheck >= COOLDOWN_POSITIVE_MS)
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

        // Cap batch size to MAX_BATCH_ITEMS to prevent freezing and large bursts
        const itemsToProcess = options?.forceAll ? itemsToSync : itemsToSync.slice(0, MAX_BATCH_ITEMS);

        logger.info(`Starting gentle background scrape/mirror for ${itemsToProcess.length} shortcut(s)...`);
        setProgress({
            isSyncing: true,
            total: itemsToProcess.length,
            current: 0,
            currentGame: itemsToProcess[0]?.name || '',
            phase: 'scraping',
        });

        let consecutiveErrors = 0;
        // Process sequentially (1 at a time) to strictly avoid hitting rate limits
        for (const [i, item] of itemsToProcess.entries()) {
            setProgress({
                current: i + 1,
                currentGame: item.name,
            });

            let itemHadError = false;

            if (item.needsMetadata) {
                try {
                    await rpc.refreshGameMetadata(item.appid, item.name);
                } catch (e: any) {
                    itemHadError = true;
                    if (String(e).includes('429')) {
                        circuitBreakerUntil = Date.now() + 30 * 60 * 1000;
                        logger.warn('Rate limit hit (429). Pausing background sync for 30 minutes.');
                        break;
                    }
                }
            }
            if (item.needsStore) {
                checkedStore.add(item.appid);
                checkedStore.add(item.appid >>> 0);
                checkedStore.add(item.appid | 0);
                try {
                    await rpc.steamStoreSearch(item.appid, item.name);
                } catch {
                    // ignore
                }
            }
            if (item.needsAchievements) {
                checkedAchievements.add(item.appid);
                checkedAchievements.add(item.appid >>> 0);
                checkedAchievements.add(item.appid | 0);
                try {
                    await rpc.cartridgesAchievementsGet(item.appid, 0);
                } catch {
                    // ignore
                }
            }

            // Update persistent history
            syncHistory[String(item.appid)] = {
                checkedAt: Date.now(),
                hasMetadata: !itemHadError,
                hasStore: !item.needsStore,
                hasAchievements: !item.needsAchievements,
            };
            saveSyncHistory(syncHistory);

            if (itemHadError) {
                consecutiveErrors++;
                if (consecutiveErrors >= 5) {
                    logger.warn('5 consecutive API scrape errors; pausing sync to protect APIs.');
                    circuitBreakerUntil = Date.now() + 15 * 60 * 1000;
                    break;
                }
            } else {
                consecutiveErrors = 0;
            }

            // Periodically refresh the UI audit counts
            if ((i + 1) % 4 === 0 || (i + 1) === itemsToProcess.length) {
                window.dispatchEvent(new CustomEvent('steam-cartridges:rule-updated'));
            }

            // Polite 300ms pause between individual games
            await new Promise((resolve) => setTimeout(resolve, 300));
        }

        saveSyncHistory(syncHistory);
        setProgress({
            isSyncing: false,
            current: itemsToProcess.length,
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
        if (pendingRerun && (Date.now() - lastFullScanTimestamp >= MIN_FULL_SCAN_INTERVAL_MS)) {
            pendingRerun = false;
            setTimeout(() => {
                void startSync();
            }, 1000);
        } else {
            pendingRerun = false;
        }
    }
}

/**
 * Debounced trigger to queue a background sync whenever settings or rules change.
 */
export function triggerSync(delayMs = 500): void {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void startSync();
    }, delayMs);
}
