import { useEffect, useState } from 'react';
import { ButtonItem, DialogControlsSection, DialogControlsSectionHeader, DropdownItem, TextField } from '@steambrew/client';
import { useSetting } from './settings';
import { rpc, type StoreState } from '../rpc';
import {
    acceptSteamStoreSuggestion,
    clearSteamStore,
    rejectSteamStoreSuggestion,
    setSteamStoreMapping,
} from '../features/steam-store';
import { refreshKnownApps } from '../features/steam-store/known-apps';
import { bucketReport, listCollections, listShortcuts, shortcutName, type Bucket, type BucketsConfig } from '../features/buckets';

/**
 * Settings panel (Millennium `definePlugin` content). SDK components only, no
 * custom CSS. Reads the in-memory settings copy and live collections.
 */

const BUCKET_LABEL: Record<Bucket, string> = { 'steam-store': 'Steam Store', 'web-scraping': 'Web Scraping', none: 'Neither' };
const OPTIONS = (Object.keys(BUCKET_LABEL) as Bucket[]).map((b) => ({ data: b, label: BUCKET_LABEL[b] }));

function Buckets({ cfg, save }: { cfg: BucketsConfig; save: (c: BucketsConfig) => void }) {
    const collections = listCollections().filter((c) => !c.id.startsWith('type-') && c.id !== 'uncategorized');
    const assignedOrder = cfg.assignments.map((a) => a.id);
    const rows = [...collections].sort((a, b) => {
        const ia = assignedOrder.indexOf(a.id);
        const ib = assignedOrder.indexOf(b.id);
        return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    });

    const setBucket = (id: string, name: string, bucket: Bucket) => {
        const rest = cfg.assignments.filter((a) => a.id !== id);
        const existing = cfg.assignments.findIndex((a) => a.id === id);
        if (bucket === 'none') return save({ ...cfg, assignments: rest });
        const entry = { id, name, bucket };
        const next = [...rest];
        next.splice(existing < 0 ? next.length : existing, 0, entry);
        save({ ...cfg, assignments: next });
    };
    const move = (id: string, delta: number) => {
        const list = [...cfg.assignments];
        const i = list.findIndex((a) => a.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j]!, list[i]!];
        save({ ...cfg, assignments: list });
    };

    return (
        <DialogControlsSection>
            <DialogControlsSectionHeader>Buckets</DialogControlsSectionHeader>
            {rows.length === 0 && <div>No collections found yet.</div>}
            {rows.map((c) => {
                const a = cfg.assignments.find((x) => x.id === c.id);
                return (
                    <div key={c.id}>
                        <DropdownItem
                            label={c.name}
                            description={`${c.shortcutCount} shortcut(s)${c.dynamic ? ', dynamic' : ''}${a ? `, precedence ${assignedOrder.indexOf(c.id) + 1}` : ''}`}
                            rgOptions={OPTIONS}
                            selectedOption={a?.bucket ?? 'none'}
                            onChange={(o) => setBucket(c.id, c.name, o.data as Bucket)}
                        />
                        {a && (
                            <>
                                <ButtonItem label="Higher precedence" onClick={() => move(c.id, -1)}>Up</ButtonItem>
                                <ButtonItem label="Lower precedence" onClick={() => move(c.id, 1)}>Down</ButtonItem>
                            </>
                        )}
                    </div>
                );
            })}
        </DialogControlsSection>
    );
}

function Overrides({ cfg, save }: { cfg: BucketsConfig; save: (c: BucketsConfig) => void }) {
    const shortcuts = listShortcuts();
    const [appid, setAppid] = useState<number | undefined>(undefined);
    const [bucket, setBucket] = useState<Bucket>('none');
    const setOverride = (id: number, b: Bucket) => save({ ...cfg, overrides: { ...cfg.overrides, [String(id)]: b } });

    return (
        <DialogControlsSection>
            <DialogControlsSectionHeader>Overrides</DialogControlsSectionHeader>
            {Object.entries(cfg.overrides).map(([id, b]) => (
                <ButtonItem
                    key={id}
                    label={`${shortcutName(Number(id))}: ${BUCKET_LABEL[b]}`}
                    onClick={() => {
                        const { [id]: _drop, ...rest } = cfg.overrides;
                        save({ ...cfg, overrides: rest });
                    }}
                >
                    Remove
                </ButtonItem>
            ))}
            <DropdownItem
                label="Game"
                rgOptions={shortcuts.map((s) => ({ data: s.appid, label: s.name }))}
                selectedOption={appid}
                onChange={(o) => setAppid(o.data as number)}
            />
            <DropdownItem label="Bucket" rgOptions={OPTIONS} selectedOption={bucket} onChange={(o) => setBucket(o.data as Bucket)} />
            <ButtonItem label="Add override" disabled={appid === undefined} onClick={() => appid !== undefined && setOverride(appid, bucket)}>
                Add
            </ButtonItem>
        </DialogControlsSection>
    );
}

function SteamStore() {
    const [state, setState] = useState<StoreState | null>(null);
    const [manual, setManual] = useState<Record<number, string>>({});
    const [error, setError] = useState<string | null>(null);
    const reload = () => {
        rpc.steamStoreGetState().then(setState).catch((e) => setError(String(e)));
    };
    useEffect(() => {
        refreshKnownApps();
        reload();
    }, []);

    const games = Object.entries(bucketReport().games).filter(([, g]) => g.bucket === 'steam-store').map(([id]) => Number(id));
    const run = (fn: () => Promise<unknown>) => () => {
        setError(null);
        fn().then(reload).catch((e) => setError(String(e)));
    };

    return (
        <DialogControlsSection>
            <DialogControlsSectionHeader>Steam Store</DialogControlsSectionHeader>
            {error && <div>{error}</div>}
            {games.length === 0 && <div>No games are in the Steam Store bucket.</div>}
            {games.map((appid) => {
                const key = String(appid);
                const mapping = state?.mappings[key];
                const suggestions = state?.suggestions[key] ?? [];
                const typed = manual[appid] ?? '';
                return (
                    <div key={appid}>
                        <div>
                            {shortcutName(appid)}:{' '}
                            {mapping ? `${mapping.name || 'Steam app'} (${mapping.steam_appid}, ${mapping.source})` : 'no match'}
                        </div>
                        {mapping && (
                            <ButtonItem label="Clear this match and its artwork; it will not be applied again" onClick={run(() => clearSteamStore(appid, true))}>
                                Clear
                            </ButtonItem>
                        )}
                        {suggestions.map((s) => (
                            <div key={s.steam_appid}>
                                <ButtonItem
                                    label={`Suggestion (${s.reason}): ${s.name} (${s.steam_appid})`}
                                    onClick={run(() => acceptSteamStoreSuggestion(appid, s.steam_appid, s.name))}
                                >
                                    Accept
                                </ButtonItem>
                                <ButtonItem label="Never suggest this one" onClick={run(() => rejectSteamStoreSuggestion(appid, s.steam_appid))}>
                                    Reject
                                </ButtonItem>
                            </div>
                        ))}
                        <TextField
                            label="Steam appid"
                            mustBeNumeric
                            value={typed}
                            onChange={(e) => setManual({ ...manual, [appid]: e.target.value })}
                        />
                        <ButtonItem
                            label="Use this Steam game"
                            disabled={!/^\d+$/.test(typed)}
                            onClick={run(async () => {
                                const res = await setSteamStoreMapping(appid, Number(typed));
                                if (res.error) throw new Error(res.error);
                                setManual({ ...manual, [appid]: '' });
                            })}
                        >
                            Set
                        </ButtonItem>
                    </div>
                );
            })}
        </DialogControlsSection>
    );
}

function Warnings({ cfg, save }: { cfg: BucketsConfig; save: (c: BucketsConfig) => void }) {
    const report = bucketReport();
    const nameOf = (id: string) => report.collections.find((c) => c.id === id)?.name ?? id;
    return (
        <DialogControlsSection>
            <DialogControlsSectionHeader>Warnings</DialogControlsSectionHeader>
            {report.conflicts.map((c) => (
                <div key={c.appid}>
                    {c.name} is in {c.collectionIds.map((id, i) => `${nameOf(id)} (${BUCKET_LABEL[c.buckets[i]!]})`).join(' and ')}; using {BUCKET_LABEL[c.using]}.
                </div>
            ))}
            {report.missing.map((m) => (
                <div key={m.id}>
                    <div>Collection "{m.name}" ({BUCKET_LABEL[m.bucket]}) no longer exists.</div>
                    {m.relinkId && (
                        <ButtonItem
                            label={`A collection named "${m.name}" exists`}
                            onClick={() =>
                                save({ ...cfg, assignments: cfg.assignments.map((a) => (a.id === m.id ? { ...a, id: m.relinkId! } : a)) })
                            }
                        >
                            Re-link
                        </ButtonItem>
                    )}
                </div>
            ))}
            {report.unbucketedWithMetadata > 0 && (
                <div>{report.unbucketedWithMetadata} game(s) have cached metadata but no bucket: they show their saved Game Info, but it is never refreshed from the web.</div>
            )}
            {report.conflicts.length === 0 && report.missing.length === 0 && report.unbucketedWithMetadata === 0 && <div>No warnings.</div>}
        </DialogControlsSection>
    );
}

export function SettingsPanel() {
    const [cfg, save] = useSetting('buckets');
    const [, tick] = useState(0);
    // Collections load after startup; re-render once so rows appear.
    useEffect(() => {
        const t = setInterval(() => tick((n) => n + 1), 3000);
        return () => clearInterval(t);
    }, []);
    return (
        <>
            <Buckets cfg={cfg} save={save} />
            <Overrides cfg={cfg} save={save} />
            <SteamStore />
            <Warnings cfg={cfg} save={save} />
        </>
    );
}
