import { useEffect, useState } from 'react';
import { ButtonItem, DialogControlsSection, DialogControlsSectionHeader, DropdownItem, TextField, ToggleField } from '@steambrew/client';
import { useSetting } from './settings';
import { rpc, type StoreState } from '../rpc';
import {
    acceptSteamStoreSuggestion,
    clearSteamStore,
    rejectSteamStoreSuggestion,
    setSteamStoreMapping,
} from '../features/steam-store';
import { refreshKnownApps } from '../features/steam-store/known-apps';
import { splitPatterns } from '../features/buckets/resolve';
import { getLocalAchievements, triggerAchievement } from '../features/achievements';
import {
    bucketReport,
    listCollections,
    listShortcuts,
    shortcutName,
    type Bucket,
    type BucketsConfig,
    type CollectionRule,
} from '../features/buckets';

/**
 * Settings panel (Millennium `definePlugin` content). SDK components only, no
 * custom CSS. Reads the in-memory settings copy and live collections.
 * Bucket model: ADR-0036 (default Steam Store, web fallback, per-collection
 * rules with include / exclude title patterns).
 */

const BUCKET_LABEL: Record<Bucket, string> = {
    'steam-store': 'Steam Store',
    'web-scraping': 'Web Scraping',
    none: 'Neither (no fetching)',
};
const OPTIONS = (Object.keys(BUCKET_LABEL) as Bucket[]).map((b) => ({ data: b, label: BUCKET_LABEL[b] }));

/** A collection without a rule uses the default. */
type Choice = Bucket | 'default';
const CHOICES: { data: Choice; label: string }[] = [{ data: 'default', label: 'Default (Steam Store, web fallback)' }, ...OPTIONS];

const PATTERN_HELP = 'Comma-separated. Plain text matches anywhere in the title; * and ? are wildcards over the whole title.';

function PatternField({ label, value, onCommit }: { label: string; value: string[]; onCommit: (text: string) => void }) {
    const joined = value.join(', ');
    const [text, setText] = useState(joined);
    useEffect(() => setText(joined), [joined]);
    return (
        <>
            <TextField label={label} description={PATTERN_HELP} value={text} onChange={(e) => setText(e.target.value)} />
            <ButtonItem label={`Save "${label}"`} disabled={text === joined} onClick={() => onCommit(text)}>
                Save
            </ButtonItem>
        </>
    );
}

function Buckets({ cfg, save }: { cfg: BucketsConfig; save: (c: BucketsConfig) => void }) {
    const collections = listCollections().filter((c) => !c.id.startsWith('type-') && c.id !== 'uncategorized');
    const order = cfg.rules.map((r) => r.id);
    const rows = [...collections].sort((a, b) => {
        const ia = order.indexOf(a.id);
        const ib = order.indexOf(b.id);
        return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    });

    const setChoice = (id: string, name: string, choice: Choice) => {
        const existing = cfg.rules.findIndex((r) => r.id === id);
        const rest = cfg.rules.filter((r) => r.id !== id);
        if (choice === 'default') return save({ ...cfg, rules: rest });
        const prev = cfg.rules[existing];
        const entry: CollectionRule = { id, name, bucket: choice, include: prev?.include ?? [], exclude: prev?.exclude ?? [] };
        const next = [...rest];
        next.splice(existing < 0 ? next.length : existing, 0, entry);
        save({ ...cfg, rules: next });
    };
    const setPatterns = (id: string, field: 'include' | 'exclude', text: string) =>
        save({ ...cfg, rules: cfg.rules.map((r) => (r.id === id ? { ...r, [field]: splitPatterns(text) } : r)) });
    const move = (id: string, delta: number) => {
        const list = [...cfg.rules];
        const i = list.findIndex((a) => a.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j]!, list[i]!];
        save({ ...cfg, rules: list });
    };

    return (
        <DialogControlsSection>
            <DialogControlsSectionHeader>Buckets</DialogControlsSectionHeader>
            <div>Games no rule claims use the Steam Store. A game with no Steam match falls back to Web Scraping.</div>
            <div>A game's bucket is kept for the session: collection changes apply after a restart or after any change here.</div>
            {rows.length === 0 && <div>No collections found yet.</div>}
            {rows.map((c) => {
                const rule = cfg.rules.find((x) => x.id === c.id);
                return (
                    <div key={c.id}>
                        <DropdownItem
                            label={c.name}
                            description={`${c.shortcutCount} shortcut(s)${c.dynamic ? ', dynamic' : ''}${rule ? `, precedence ${order.indexOf(c.id) + 1}` : ''}`}
                            rgOptions={CHOICES}
                            selectedOption={rule?.bucket ?? 'default'}
                            onChange={(o) => setChoice(c.id, c.name, o.data as Choice)}
                        />
                        {rule && (
                            <>
                                <PatternField label="Only titles matching" value={rule.include} onCommit={(t) => setPatterns(c.id, 'include', t)} />
                                <PatternField label="Except titles matching" value={rule.exclude} onCommit={(t) => setPatterns(c.id, 'exclude', t)} />
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
    const [target, setTarget] = useState<number | undefined>(undefined);
    const [typed, setTyped] = useState('');
    const [error, setError] = useState<string | null>(null);
    const reload = () => {
        rpc.steamStoreGetState().then(setState).catch((e) => setError(String(e)));
    };
    useEffect(() => {
        refreshKnownApps();
        reload();
    }, []);

    // Only games with something to show: a match, suggestions, or art we wrote
    // (including art left behind without a match; P4 H5). Every shortcut is
    // steam-store by default (ADR-0036), so listing them all would be ~200 rows.
    const ids = new Set<number>(
        [
            ...Object.keys(state?.mappings ?? {}),
            ...Object.keys(state?.suggestions ?? {}),
            ...Object.keys(state?.applied_artwork ?? {}),
        ].map(Number),
    );
    const games = [...ids].sort((a, b) => shortcutName(a).localeCompare(shortcutName(b)));
    const run = (fn: () => Promise<unknown>) => () => {
        setError(null);
        fn().then(reload).catch((e) => setError(String(e)));
    };

    return (
        <DialogControlsSection>
            <DialogControlsSectionHeader>Steam Store</DialogControlsSectionHeader>
            {error && <div>{error}</div>}
            {games.length === 0 && <div>No Steam matches yet. Open a game's page to look it up.</div>}
            {games.map((appid) => {
                const key = String(appid);
                const mapping = state?.mappings[key];
                const applied = state?.applied_artwork[key];
                const suggestions = state?.suggestions[key] ?? [];
                const status = mapping
                    ? `${mapping.name || 'Steam app'} (${mapping.steam_appid}, ${mapping.source})`
                    : applied
                      ? `artwork from ${applied.steam_appid} but no match`
                      : 'no match';
                return (
                    <div key={appid}>
                        <div>
                            {shortcutName(appid)}: {status}
                        </div>
                        {(mapping || applied) && (
                            <ButtonItem
                                label="Clear this match and the artwork it wrote; a cleared match is not applied again"
                                onClick={run(() => clearSteamStore(appid, !!mapping))}
                            >
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
                    </div>
                );
            })}
            <DropdownItem
                label="Match a game by hand"
                rgOptions={listShortcuts().map((s) => ({ data: s.appid, label: s.name }))}
                selectedOption={target}
                onChange={(o) => setTarget(o.data as number)}
            />
            <TextField label="Steam appid" mustBeNumeric value={typed} onChange={(e) => setTyped(e.target.value)} />
            <ButtonItem
                label="Use this Steam game"
                disabled={target === undefined || !/^\d+$/.test(typed)}
                onClick={run(async () => {
                    if (target === undefined) return;
                    const res = await setSteamStoreMapping(target, Number(typed));
                    if (res.error) throw new Error(res.error);
                    setTyped('');
                })}
            >
                Set
            </ButtonItem>
        </DialogControlsSection>
    );
}

function GameInfo() {
    const [defaultFull, setDefaultFull] = useSetting('defaultFullController');
    return (
        <DialogControlsSection>
            <DialogControlsSectionHeader>Game Info</DialogControlsSectionHeader>
            <ToggleField
                label="Default to full controller support"
                description="Shows Full Controller Support for games without Steam Store data whose emulator is not recognised. Steam Store data and recognised emulators always decide first."
                checked={defaultFull}
                onChange={setDefaultFull}
            />
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
                            onClick={() => save({ ...cfg, rules: cfg.rules.map((a) => (a.id === m.id ? { ...a, id: m.relinkId! } : a)) })}
                        >
                            Re-link
                        </ButtonItem>
                    )}
                </div>
            ))}
            {report.unbucketedWithMetadata > 0 && (
                <div>{report.unbucketedWithMetadata} game(s) with saved metadata are set to Neither: they show their saved Game Info, but it is never refreshed.</div>
            )}
            {report.conflicts.length === 0 && report.missing.length === 0 && report.unbucketedWithMetadata === 0 && <div>No warnings.</div>}
        </DialogControlsSection>
    );
}

const LAUNCH_NOTIFY_OPTIONS = [
    { data: 'all_runs', label: 'All game runs (default)' },
    { data: 'first_run', label: 'First game run only' },
    { data: 'off', label: 'Off (never notify)' },
];

function AchievementsSettings() {
    const [policy, setPolicy] = useSetting('localAchievementsNotifyOnLaunch');
    const [testStatus, setTestStatus] = useState<string>('');

    const handleTestUnlock = async () => {
        setTestStatus('Unlocking...');
        const shortcuts = listShortcuts();
        const target = shortcuts.find((s) => getLocalAchievements(s.appid)) || shortcuts[0];
        if (!target) {
            setTestStatus('No non-Steam shortcuts found');
            return;
        }
        const ok = await triggerAchievement(target.appid);
        setTestStatus(ok ? `Unlocked on ${target.name}!` : 'Unlock failed (no schema)');
        setTimeout(() => setTestStatus(''), 4000);
    };

    return (
        <DialogControlsSection>
            <DialogControlsSectionHeader>Local Achievements</DialogControlsSectionHeader>
            <DropdownItem
                label="Launch Notification"
                description="Shows a native Steam toast notification on game start when achievements tracking is active."
                rgOptions={LAUNCH_NOTIFY_OPTIONS}
                selectedOption={policy}
                onChange={(opt: any) => setPolicy(opt.data)}
            />
            <ButtonItem
                label="Test Native Toast & Unlock"
                description={testStatus || "Simulates an in-game achievement unlock to test notification toast, audio, and UI updates."}
                onClick={handleTestUnlock}
            >
                Test Unlock
            </ButtonItem>
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
            <GameInfo />
            <AchievementsSettings />
            <Warnings cfg={cfg} save={save} />
        </>
    );
}

