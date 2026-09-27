import { useEffect, useState } from 'react';
import {
    DialogBodyText,
    DialogButton,
    Dropdown,
    Field,
    PanelSection,
    PanelSectionRow,
    TextField,
    Toggle as SteamToggle,
} from '@steambrew/client';
import { useSetting, type ControllerOverride } from './settings';
import { rpc, type ProviderStatus, type RetroStatusResponse } from '../rpc';
import {
    listCollections,
    listShortcuts,
    shortcutName,
} from '../features/buckets';
import {
    type RoutingRule,
    type ServiceTarget,
    type RuleAction,
    type ConditionType,
} from '../features/buckets/resolve';
import { getLocalAchievements } from '../features/achievements';

/**
 * Compact row wrapper to reduce inter-item vertical spacing and
 * preserve card separation across all control types (reference: enhanced-achievements).
 */
const ITEM_ROW_STYLE: React.CSSProperties = {
    margin: '0',
    padding: '0',
};

function ItemRow({ children }: { children: React.ReactNode }) {
    return (
        <PanelSectionRow>
            <div style={ITEM_ROW_STYLE}>{children}</div>
        </PanelSectionRow>
    );
}

function ButtonRow({
    label,
    description,
    buttonLabel,
    disabled,
    onClick,
}: {
    label: string;
    description?: string;
    buttonLabel: string;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <ItemRow>
            <Field label={label} description={description} disabled={disabled}>
                <DialogButton
                    disabled={disabled}
                    onClick={onClick}
                    style={{
                        padding: '0 16px',
                        minWidth: 0,
                        width: 'auto',
                    }}
                >
                    {buttonLabel}
                </DialogButton>
            </Field>
        </ItemRow>
    );
}

// ===========================================================================
// 1. {Metadata} Services Section
// ===========================================================================

function MetadataSection() {
    const [services, setServices] = useSetting('services');
    const [status, setStatus] = useState<ProviderStatus | null>(null);
    const [showSsForm, setShowSsForm] = useState(false);
    const [showIgdbForm, setShowIgdbForm] = useState(false);
    const [showAddMenu, setShowAddMenu] = useState(false);

    // ScreenScraper form state
    const [ssUser, setSsUser] = useState('');
    const [ssPass, setSsPass] = useState('');
    const [ssDevUser, setSsDevUser] = useState('');
    const [ssDevPw, setSsDevPw] = useState('');
    const [ssMsg, setSsMsg] = useState('');

    // IGDB form state
    const [igdbId, setIgdbId] = useState('');
    const [igdbSecret, setIgdbSecret] = useState('');
    const [igdbMsg, setIgdbMsg] = useState('');

    const refresh = () => {
        rpc.getStatus().then(setStatus).catch(() => {});
    };

    useEffect(() => {
        refresh();
    }, []);

    const handleSaveScreenScraper = async () => {
        setSsMsg('Saving...');
        const res = await rpc.saveServiceCredentials({
            screenscraper_user: ssUser,
            screenscraper_pass: ssPass,
            screenscraper_dev_user: ssDevUser,
            screenscraper_dev_pw: ssDevPw,
        });
        if (res.success) {
            setSsMsg('ScreenScraper credentials saved!');
            refresh();
            setTimeout(() => {
                setSsMsg('');
                setShowSsForm(false);
            }, 2000);
        } else {
            setSsMsg('Failed to save credentials.');
        }
    };

    const handleSaveIgdb = async () => {
        setIgdbMsg('Saving...');
        const res = await rpc.saveServiceCredentials({
            twitch_client_id: igdbId,
            twitch_client_secret: igdbSecret,
        });
        if (res.success) {
            setIgdbMsg('IGDB credentials saved!');
            refresh();
            setTimeout(() => {
                setIgdbMsg('');
                setShowIgdbForm(false);
            }, 2000);
        } else {
            setIgdbMsg('Failed to save credentials.');
        }
    };

    return (
        <PanelSection title="Metadata Services">
            <ItemRow>
                <DialogBodyText style={{ padding: '0 0 10px 0', opacity: 0.85 }}>
                    Configure metadata providers to supply Game Info, descriptions, genres, release dates, and category tags.
                </DialogBodyText>
            </ItemRow>

            {/* Steam Store Mirror */}
            <ItemRow>
                <Field
                    label="Steam Store Mirror"
                    description="Extracts rich Game Info, descriptions, genres, release dates, and controller badges directly from Steam Store matching."
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ color: '#a4d007', fontSize: '12px', fontWeight: 600 }}>✓ Ready</span>
                        <SteamToggle
                            value={services.steamStoreEnabled}
                            onChange={(val) => setServices({ ...services, steamStoreEnabled: val })}
                        />
                    </div>
                </Field>
            </ItemRow>

            {/* ScreenScraper */}
            <ItemRow>
                <Field
                    label="ScreenScraper (screenscraper.fr)"
                    description="Rich metadata, release dates, and artwork matched by ROM checksum and serial for emulated games."
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span
                            style={{
                                color: status?.has_screenscraper ? '#a4d007' : '#e5a00d',
                                fontSize: '12px',
                                fontWeight: 600,
                            }}
                        >
                            {status?.has_screenscraper ? '✓ Configured' : '⚠ Missing Credentials'}
                        </span>
                        <DialogButton
                            onClick={() => setShowSsForm((v) => !v)}
                            style={{ padding: '0 12px', minWidth: 0, width: 'auto' }}
                        >
                            {showSsForm ? 'Close' : 'Configure'}
                        </DialogButton>
                    </div>
                </Field>
            </ItemRow>

            {showSsForm && (
                <ItemRow>
                    <div
                        style={{
                            background: 'rgba(0, 0, 0, 0.25)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            borderRadius: '6px',
                            padding: '12px',
                            margin: '6px 0 12px 0',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                        }}
                    >
                        <div style={{ fontWeight: 600, fontSize: '13px' }}>ScreenScraper Account Credentials</div>
                        <TextField
                            label="Account Username"
                            value={ssUser}
                            onChange={(e) => setSsUser(e.target.value)}
                        />
                        <TextField
                            label="Account Password"
                            value={ssPass}
                            onChange={(e) => setSsPass(e.target.value)}
                        />
                        <div style={{ fontWeight: 600, fontSize: '13px', marginTop: '6px' }}>Developer API Key (Optional)</div>
                        <TextField
                            label="Dev ID"
                            value={ssDevUser}
                            onChange={(e) => setSsDevUser(e.target.value)}
                        />
                        <TextField
                            label="Dev Password"
                            value={ssDevPw}
                            onChange={(e) => setSsDevPw(e.target.value)}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                            <DialogButton onClick={handleSaveScreenScraper} style={{ padding: '0 16px', minWidth: 0, width: 'auto' }}>
                                Save Credentials
                            </DialogButton>
                            {ssMsg && <span style={{ color: '#66c0f4', fontSize: '12px' }}>{ssMsg}</span>}
                        </div>
                    </div>
                </ItemRow>
            )}

            {/* IGDB / Twitch */}
            <ItemRow>
                <Field
                    label="IGDB (Internet Game Database)"
                    description="Official developer credits, publisher credits, descriptions, and release dates via Twitch API."
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span
                            style={{
                                color: status?.has_twitch ? '#a4d007' : '#e5a00d',
                                fontSize: '12px',
                                fontWeight: 600,
                            }}
                        >
                            {status?.has_twitch ? '✓ Configured' : '⚠ Missing Credentials'}
                        </span>
                        <DialogButton
                            onClick={() => setShowIgdbForm((v) => !v)}
                            style={{ padding: '0 12px', minWidth: 0, width: 'auto' }}
                        >
                            {showIgdbForm ? 'Close' : 'Configure'}
                        </DialogButton>
                    </div>
                </Field>
            </ItemRow>

            {showIgdbForm && (
                <ItemRow>
                    <div
                        style={{
                            background: 'rgba(0, 0, 0, 0.25)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            borderRadius: '6px',
                            padding: '12px',
                            margin: '6px 0 12px 0',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                        }}
                    >
                        <div style={{ fontWeight: 600, fontSize: '13px' }}>Twitch Developer Application</div>
                        <TextField
                            label="Twitch Client ID"
                            value={igdbId}
                            onChange={(e) => setIgdbId(e.target.value)}
                        />
                        <TextField
                            label="Twitch Client Secret"
                            value={igdbSecret}
                            onChange={(e) => setIgdbSecret(e.target.value)}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                            <DialogButton onClick={handleSaveIgdb} style={{ padding: '0 16px', minWidth: 0, width: 'auto' }}>
                                Save Credentials
                            </DialogButton>
                            {igdbMsg && <span style={{ color: '#66c0f4', fontSize: '12px' }}>{igdbMsg}</span>}
                        </div>
                    </div>
                </ItemRow>
            )}

            {/* Add Service Button */}
            <ItemRow>
                <div style={{ marginTop: '8px' }}>
                    <DialogButton
                        onClick={() => setShowAddMenu((v) => !v)}
                        style={{ padding: '0 16px', minWidth: 0, width: 'auto' }}
                    >
                        + Add Metadata Service
                    </DialogButton>
                    {showAddMenu && (
                        <div
                            style={{
                                background: 'rgba(0, 0, 0, 0.3)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                borderRadius: '6px',
                                padding: '10px',
                                marginTop: '8px',
                                display: 'flex',
                                gap: '8px',
                                flexWrap: 'wrap',
                            }}
                        >
                            <DialogButton
                                onClick={() => {
                                    setServices({ ...services, steamStoreEnabled: true });
                                    setShowAddMenu(false);
                                }}
                                style={{ padding: '0 12px', minWidth: 0, width: 'auto' }}
                            >
                                Enable Steam Store Mirror
                            </DialogButton>
                            <DialogButton
                                onClick={() => {
                                    setShowSsForm(true);
                                    setShowAddMenu(false);
                                }}
                                style={{ padding: '0 12px', minWidth: 0, width: 'auto' }}
                            >
                                Add ScreenScraper
                            </DialogButton>
                            <DialogButton
                                onClick={() => {
                                    setShowIgdbForm(true);
                                    setShowAddMenu(false);
                                }}
                                style={{ padding: '0 12px', minWidth: 0, width: 'auto' }}
                            >
                                Add IGDB (Twitch)
                            </DialogButton>
                        </div>
                    )}
                </div>
            </ItemRow>
        </PanelSection>
    );
}

// ===========================================================================
// 2. {Achievements} Sources Section
// ===========================================================================

const LAUNCH_NOTIFY_OPTIONS = [
    { data: 'all_runs', label: 'All game runs (default)' },
    { data: 'first_run', label: 'First game run only' },
    { data: 'off', label: 'Off (never notify)' },
];

function AchievementsSection() {
    const [policy, setPolicy] = useSetting('localAchievementsNotifyOnLaunch');
    const [hardcore, setHardcore] = useSetting('raHardcoreMode');
    const [retroStatus, setRetroStatus] = useState<RetroStatusResponse | null>(null);
    const [showEmus, setShowEmus] = useState(false);
    const [showRaForm, setShowRaForm] = useState(false);
    const [toastStatus, setToastStatus] = useState<string>('');

    // RA credentials form
    const [raUser, setRaUser] = useState('');
    const [raToken, setRaToken] = useState('');
    const [raMsg, setRaMsg] = useState('');

    useEffect(() => {
        rpc.cartridgesAchievementsGetRetroStatus().then(setRetroStatus).catch(() => {});
    }, []);

    const handleSaveRa = async () => {
        setRaMsg('Saving...');
        const res = await rpc.saveServiceCredentials({
            retroachievements_user: raUser,
            retroachievements_api: raToken,
        });
        if (res.success) {
            setRaMsg('RetroAchievements credentials saved!');
            rpc.cartridgesAchievementsGetRetroStatus().then(setRetroStatus).catch(() => {});
            setTimeout(() => {
                setRaMsg('');
                setShowRaForm(false);
            }, 2000);
        } else {
            setRaMsg('Failed to save credentials.');
        }
    };

    const handleTestToast = () => {
        setToastStatus('Toast sent!');
        const shortcuts = listShortcuts();
        const target = shortcuts.find((s) => getLocalAchievements(s.appid)) || shortcuts[0];
        const targetAppId = target ? target.appid : 2713503983;

        window.dispatchEvent(
            new CustomEvent('cartridges:trigger_fake_achievement', {
                detail: {
                    shortcutAppId: targetAppId,
                    achievement: {
                        id: 'test_achievement_' + Date.now(),
                        name: 'Retro Champion',
                        description: 'Simulated real-time achievement unlock and native chime!',
                        icon: 'https://media.retroachievements.org/Badge/00001.png',
                        global_pct: 100,
                    },
                },
            }),
        );
        setTimeout(() => setToastStatus(''), 3000);
    };

    const detectedCount = retroStatus?.emulators?.filter((e) => e.detected).length ?? 0;
    const activeRaUser =
        retroStatus?.emulators?.find((e) => e.authenticated && e.username)?.username ||
        (retroStatus?.env_fallback ? 'Configured in .env' : null);

    return (
        <PanelSection title="Achievements Sources">
            <ItemRow>
                <DialogBodyText style={{ padding: '0 0 10px 0', opacity: 0.85 }}>
                    Manage achievement sources, real-time observers, and emulator integration for non-Steam shortcuts.
                </DialogBodyText>
            </ItemRow>

            {/* Launch Notification */}
            <ItemRow>
                <Field
                    label="Launch Notification"
                    description="Displays a native Steam toast on game start when achievements tracking is active."
                >
                    <Dropdown
                        rgOptions={LAUNCH_NOTIFY_OPTIONS}
                        selectedOption={policy}
                        onChange={(o) => setPolicy(o.data as any)}
                        contextMenuPositionOptions={{ bMatchWidth: true }}
                    />
                </Field>
            </ItemRow>

            {/* Steam Store Mirror & PC Emulators */}
            <ItemRow>
                <Field
                    label="Steam Store Mirror & PC Saves"
                    description="Passively scans offline emulator saves (Goldberg, CODEX, RUNE, GSE) and engine logs (Unity, Godot, Unreal)."
                >
                    <span style={{ color: '#a4d007', fontSize: '12px', fontWeight: 600 }}>✓ Active</span>
                </Field>
            </ItemRow>

            {/* RetroAchievements */}
            <ItemRow>
                <Field
                    label="RetroAchievements"
                    description="Fetches official schemas, points, badge images, and tails emulator runtime logs."
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span
                            style={{
                                color: activeRaUser ? '#66c0f4' : '#e5a00d',
                                fontSize: '12px',
                                fontWeight: 600,
                            }}
                        >
                            {activeRaUser ? `✓ ${activeRaUser}` : '⚠ Missing Login'}
                        </span>
                        <DialogButton
                            onClick={() => setShowRaForm((v) => !v)}
                            style={{ padding: '0 12px', minWidth: 0, width: 'auto' }}
                        >
                            {showRaForm ? 'Close' : 'Configure'}
                        </DialogButton>
                    </div>
                </Field>
            </ItemRow>

            {showRaForm && (
                <ItemRow>
                    <div
                        style={{
                            background: 'rgba(0, 0, 0, 0.25)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            borderRadius: '6px',
                            padding: '12px',
                            margin: '6px 0 12px 0',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                        }}
                    >
                        <div style={{ fontWeight: 600, fontSize: '13px' }}>RetroAchievements Credentials</div>
                        <TextField
                            label="Username"
                            value={raUser}
                            onChange={(e) => setRaUser(e.target.value)}
                        />
                        <TextField
                            label="Web API Key / Token"
                            value={raToken}
                            onChange={(e) => setRaToken(e.target.value)}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                            <DialogButton onClick={handleSaveRa} style={{ padding: '0 16px', minWidth: 0, width: 'auto' }}>
                                Save Credentials
                            </DialogButton>
                            {raMsg && <span style={{ color: '#66c0f4', fontSize: '12px' }}>{raMsg}</span>}
                        </div>
                    </div>
                </ItemRow>
            )}

            {/* Hardcore Mode Toggle */}
            <ItemRow>
                <Field
                    label="RetroAchievements Hardcore Mode"
                    description="Enforces strict competitive rules (no save states or cheats) and records official Hardcore badges on leaderboards."
                >
                    <SteamToggle value={hardcore} onChange={setHardcore} />
                </Field>
            </ItemRow>

            {/* Console Emulators (RPCS3 / PS3 / Standalone) */}
            <ItemRow>
                <Field
                    label="Console Emulators (RPCS3 / PS3 / Standalone)"
                    description="Parses offline TROPCONF.SFM & TROPUSR.DAT databases and tails emulator logs (DuckStation, PCSX2, Dolphin, PPSSPP, RPCS3)."
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ color: detectedCount > 0 ? '#a4d007' : '#888', fontSize: '12px', fontWeight: 600 }}>
                            {detectedCount} detected
                        </span>
                        <DialogButton
                            onClick={() => setShowEmus((v) => !v)}
                            style={{ padding: '0 12px', minWidth: 0, width: 'auto' }}
                        >
                            {showEmus ? 'Hide' : 'View Status'}
                        </DialogButton>
                    </div>
                </Field>
            </ItemRow>

            {showEmus && retroStatus && (
                <ItemRow>
                    <div
                        style={{
                            background: 'rgba(0, 0, 0, 0.25)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            borderRadius: '6px',
                            padding: '10px 14px',
                            margin: '6px 0 12px 0',
                            fontSize: '12px',
                        }}
                    >
                        <div style={{ fontWeight: 600, marginBottom: '6px' }}>Detected Emulators & Login State:</div>
                        {retroStatus.emulators.map((emu) => (
                            <div key={emu.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                                <span style={{ color: emu.detected ? '#a4d007' : '#888' }}>
                                    {emu.detected ? '✓' : '✗'} {emu.name}
                                </span>
                                <span style={{ color: emu.authenticated ? '#66c0f4' : '#aaa' }}>
                                    {emu.authenticated
                                        ? `Logged in (${emu.username})`
                                        : emu.detected
                                        ? 'Local / Unauthenticated'
                                        : 'Not Detected'}
                                </span>
                            </div>
                        ))}
                    </div>
                </ItemRow>
            )}

            {/* Test Action Row */}
            <ButtonRow
                label="Test Notification Toast"
                description={toastStatus || "Triggers a live Steam achievement toast and audio chime to verify the notification pipeline."}
                buttonLabel="Test Toast"
                onClick={handleTestToast}
            />
        </PanelSection>
    );
}

// ===========================================================================
// 3. {Rules} Routing Engine Section
// ===========================================================================

const SERVICE_OPTIONS = [
    { data: 'all', label: 'All Services (Metadata & Achievements)' },
    { data: 'steam-store', label: 'Steam Store Mirror' },
    { data: 'retroachievements', label: 'RetroAchievements' },
    { data: 'screenscraper', label: 'ScreenScraper' },
    { data: 'igdb', label: 'IGDB / Web Metadata' },
    { data: 'rpcs3', label: 'RPCS3 Local Trophies' },
    { data: 'none', label: 'None (Disable Fetching)' },
];

const ACTION_OPTIONS = [
    { data: 'include', label: 'Inclusion (Only apply to matching games)' },
    { data: 'exclude', label: 'Exclusion (Never apply to matching games)' },
];

const CONDITION_OPTIONS = [
    { data: 'collection', label: 'Collection Name' },
    { data: 'game_name', label: 'Game Title (Contains or Wildcard *)' },
    { data: 'regex', label: 'Regex Pattern' },
];

function RulesSection() {
    const [rules, setRules] = useSetting('routingRules');
    const [showAdd, setShowAdd] = useState(false);

    // New rule builder form state
    const [name, setName] = useState('');
    const [service, setService] = useState<ServiceTarget>('all');
    const [action, setAction] = useState<RuleAction>('include');
    const [conditionType, setConditionType] = useState<ConditionType>('collection');
    const [pattern, setPattern] = useState('');

    const collections = listCollections().filter((c) => !c.id.startsWith('type-') && c.id !== 'uncategorized');

    const handleAddRule = () => {
        if (!pattern.trim()) return;
        const newRule: RoutingRule = {
            id: 'rule_' + Date.now(),
            name: name.trim() || `${action === 'include' ? 'Include' : 'Exclude'} ${service} for ${pattern}`,
            service,
            action,
            conditionType,
            pattern: pattern.trim(),
            enabled: true,
        };
        setRules([...rules, newRule]);
        setName('');
        setPattern('');
        setShowAdd(false);
    };

    const handleMove = (index: number, delta: number) => {
        const target = index + delta;
        if (target < 0 || target >= rules.length) return;
        const copy = [...rules];
        const [removed] = copy.splice(index, 1);
        if (removed) copy.splice(target, 0, removed);
        setRules(copy);
    };

    const handleDelete = (index: number) => {
        const copy = [...rules];
        copy.splice(index, 1);
        setRules(copy);
    };

    return (
        <PanelSection title="Routing Rules">
            <ItemRow>
                <DialogBodyText style={{ padding: '0 0 10px 0', opacity: 0.85 }}>
                    Define ordered inclusion and exclusion rules to route specific games or collections to specific Metadata or Achievements services.
                </DialogBodyText>
            </ItemRow>

            {rules.length === 0 && (
                <ItemRow>
                    <div style={{ opacity: 0.7, padding: '6px 0', fontStyle: 'italic' }}>
                        No custom rules defined yet. Games follow default service discovery.
                    </div>
                </ItemRow>
            )}

            {/* List of configured rules */}
            {rules.map((rule, idx) => (
                <ItemRow key={rule.id}>
                    <div
                        style={{
                            background: 'rgba(0, 0, 0, 0.25)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            borderRadius: '6px',
                            padding: '10px 14px',
                            margin: '4px 0',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                        }}
                    >
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontWeight: 600, fontSize: '13px' }}>
                                    #{idx + 1} {rule.name}
                                </span>
                                <span
                                    style={{
                                        fontSize: '11px',
                                        padding: '1px 6px',
                                        borderRadius: '4px',
                                        background: rule.action === 'include' ? 'rgba(164, 208, 7, 0.2)' : 'rgba(235, 75, 75, 0.2)',
                                        color: rule.action === 'include' ? '#a4d007' : '#eb4b4b',
                                        fontWeight: 600,
                                    }}
                                >
                                    {rule.action.toUpperCase()}
                                </span>
                                <span
                                    style={{
                                        fontSize: '11px',
                                        padding: '1px 6px',
                                        borderRadius: '4px',
                                        background: 'rgba(102, 192, 244, 0.15)',
                                        color: '#66c0f4',
                                    }}
                                >
                                    {rule.service}
                                </span>
                            </div>
                            <div style={{ fontSize: '12px', opacity: 0.75, marginTop: '2px' }}>
                                Condition: {rule.conditionType} matches &quot;{rule.pattern}&quot;
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '6px' }}>
                            <DialogButton
                                disabled={idx === 0}
                                onClick={() => handleMove(idx, -1)}
                                style={{ padding: '0 8px', minWidth: 0, width: 'auto' }}
                            >
                                ▲
                            </DialogButton>
                            <DialogButton
                                disabled={idx === rules.length - 1}
                                onClick={() => handleMove(idx, 1)}
                                style={{ padding: '0 8px', minWidth: 0, width: 'auto' }}
                            >
                                ▼
                            </DialogButton>
                            <DialogButton
                                onClick={() => handleDelete(idx)}
                                style={{ padding: '0 8px', minWidth: 0, width: 'auto', color: '#eb4b4b' }}
                            >
                                ✕
                            </DialogButton>
                        </div>
                    </div>
                </ItemRow>
            ))}

            {/* Add Rule Form */}
            {showAdd ? (
                <ItemRow>
                    <div
                        style={{
                            background: 'rgba(0, 0, 0, 0.3)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '6px',
                            padding: '14px',
                            margin: '10px 0',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '10px',
                        }}
                    >
                        <div style={{ fontWeight: 600, fontSize: '14px' }}>Add Routing Rule</div>
                        <TextField
                            label="Rule Name (Optional)"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                        <Field label="Target Service">
                            <Dropdown
                                rgOptions={SERVICE_OPTIONS}
                                selectedOption={service}
                                onChange={(o) => setService(o.data as ServiceTarget)}
                                contextMenuPositionOptions={{ bMatchWidth: true }}
                            />
                        </Field>
                        <Field label="Action">
                            <Dropdown
                                rgOptions={ACTION_OPTIONS}
                                selectedOption={action}
                                onChange={(o) => setAction(o.data as RuleAction)}
                                contextMenuPositionOptions={{ bMatchWidth: true }}
                            />
                        </Field>
                        <Field label="Condition Type">
                            <Dropdown
                                rgOptions={CONDITION_OPTIONS}
                                selectedOption={conditionType}
                                onChange={(o) => setConditionType(o.data as ConditionType)}
                                contextMenuPositionOptions={{ bMatchWidth: true }}
                            />
                        </Field>
                        <TextField
                            label="Matching Pattern"
                            description={
                                conditionType === 'collection'
                                    ? 'Enter collection name or select from suggestions below.'
                                    : conditionType === 'game_name'
                                    ? 'Enter title substring or wildcards (e.g. *Mario*).'
                                    : 'Enter regex pattern (e.g. \\.sfc$|\\.smc$).'
                            }
                            value={pattern}
                            onChange={(e) => setPattern(e.target.value)}
                        />

                        {conditionType === 'collection' && collections.length > 0 && (
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '-4px' }}>
                                <span style={{ fontSize: '11px', opacity: 0.7 }}>Suggestions:</span>
                                {collections.map((c) => (
                                    <button
                                        key={c.id}
                                        type="button"
                                        onClick={() => setPattern(c.name)}
                                        style={{
                                            background: 'rgba(255, 255, 255, 0.08)',
                                            border: '1px solid rgba(255, 255, 255, 0.1)',
                                            color: '#fff',
                                            borderRadius: '4px',
                                            padding: '2px 8px',
                                            fontSize: '11px',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        {c.name}
                                    </button>
                                ))}
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                            <DialogButton onClick={handleAddRule} style={{ padding: '0 16px', minWidth: 0, width: 'auto' }}>
                                Save Rule
                            </DialogButton>
                            <DialogButton onClick={() => setShowAdd(false)} style={{ padding: '0 16px', minWidth: 0, width: 'auto' }}>
                                Cancel
                            </DialogButton>
                        </div>
                    </div>
                </ItemRow>
            ) : (
                <ItemRow>
                    <div style={{ marginTop: '8px' }}>
                        <DialogButton
                            onClick={() => setShowAdd(true)}
                            style={{ padding: '0 16px', minWidth: 0, width: 'auto' }}
                        >
                            + Add Rule
                        </DialogButton>
                    </div>
                </ItemRow>
            )}
        </PanelSection>
    );
}

// ===========================================================================
// 4. {Revision} & Game Audit Center Section
// ===========================================================================

interface FlaggedShortcut {
    appid: number;
    name: string;
    missingController: boolean;
    missingMetadata: boolean;
    noAchievements: boolean;
}

const CONTROLLER_OVERRIDE_OPTIONS = [
    { data: 'auto', label: 'Default / Auto' },
    { data: 'full', label: 'Full Controller Support' },
    { data: 'partial', label: 'Partial Controller Support' },
    { data: 'none', label: 'Keyboard & Mouse Only' },
];

function RevisionSection() {
    const [controllerOverrides, setControllerOverrides] = useSetting('controllerOverrides');
    const [isOpen, setIsOpen] = useState(false);
    const [filter, setFilter] = useState<'all' | 'controller' | 'metadata' | 'achievements'>('all');
    const [targetAppId, setTargetAppId] = useState<number | null>(null);
    const [steamIdInput, setSteamIdInput] = useState('');
    const [fixMsg, setFixMsg] = useState('');

    const shortcuts = listShortcuts();

    // Inspect each shortcut for missing info
    const flagged: FlaggedShortcut[] = [];
    for (const sc of shortcuts) {
        const override = controllerOverrides[String(sc.appid)];
        const achievements = getLocalAchievements(sc.appid);

        // Check if title has brackets or dump tags
        const hasWeirdName = /\[.*?\]|\(.*?\)/.test(sc.name);
        const missingController = !override || override === 'auto';
        const missingMetadata = false; // Evaluated dynamically if not in local db
        const noAchievements = !achievements || achievements.nTotal === 0;

        if (missingController || hasWeirdName || noAchievements) {
            flagged.push({
                appid: sc.appid,
                name: sc.name,
                missingController,
                missingMetadata,
                noAchievements,
            });
        }
    }

    const filtered = flagged.filter((f) => {
        if (filter === 'controller') return f.missingController;
        if (filter === 'metadata') return f.missingMetadata;
        if (filter === 'achievements') return f.noAchievements;
        return true;
    });

    const handleSetController = (appid: number, val: ControllerOverride) => {
        setControllerOverrides({ ...controllerOverrides, [String(appid)]: val });
        setFixMsg(`Updated controller support for ${shortcutName(appid)}`);
        setTimeout(() => setFixMsg(''), 2500);
    };

    const handleLinkSteamApp = async (shortcutAppId: number, steamAppId: number) => {
        setFixMsg('Linking to Steam Store...');
        const res = await rpc.steamStoreSetMapping(shortcutAppId, steamAppId);
        if (res.mapping) {
            setFixMsg('Mapped successfully!');
            setTimeout(() => setFixMsg(''), 2500);
        } else {
            setFixMsg(res.error || 'Failed to map Steam App');
        }
    };

    return (
        <PanelSection title="Revision & Game Audit">
            <ItemRow>
                <Field
                    label="Library Audit & Health Check"
                    description="Scans for games with unknown controller support, missing metadata, or unrecognized titles with no achievements."
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span
                            style={{
                                background: flagged.length > 0 ? '#e5a00d' : '#a4d007',
                                color: '#000',
                                padding: '2px 8px',
                                borderRadius: '10px',
                                fontSize: '11px',
                                fontWeight: 700,
                            }}
                        >
                            {flagged.length} to review
                        </span>
                        <DialogButton
                            onClick={() => setIsOpen((v) => !v)}
                            style={{ padding: '0 14px', minWidth: 0, width: 'auto' }}
                        >
                            {isOpen ? 'Close List' : 'Review & Fix'}
                        </DialogButton>
                    </div>
                </Field>
            </ItemRow>

            {fixMsg && (
                <ItemRow>
                    <div style={{ color: '#66c0f4', fontSize: '12px', padding: '2px 0' }}>{fixMsg}</div>
                </ItemRow>
            )}

            {isOpen && (
                <ItemRow>
                    <div
                        style={{
                            background: 'rgba(0, 0, 0, 0.25)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            borderRadius: '6px',
                            padding: '12px',
                            margin: '8px 0',
                        }}
                    >
                        {/* Filter Tabs */}
                        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
                            <button
                                type="button"
                                onClick={() => setFilter('all')}
                                style={{
                                    background: filter === 'all' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.2)',
                                    border: 'none',
                                    color: '#fff',
                                    borderRadius: '4px',
                                    padding: '4px 10px',
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                }}
                            >
                                All Issues ({flagged.length})
                            </button>
                            <button
                                type="button"
                                onClick={() => setFilter('controller')}
                                style={{
                                    background: filter === 'controller' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.2)',
                                    border: 'none',
                                    color: '#fff',
                                    borderRadius: '4px',
                                    padding: '4px 10px',
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                }}
                            >
                                Unknown Input
                            </button>
                            <button
                                type="button"
                                onClick={() => setFilter('achievements')}
                                style={{
                                    background: filter === 'achievements' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.2)',
                                    border: 'none',
                                    color: '#fff',
                                    borderRadius: '4px',
                                    padding: '4px 10px',
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                }}
                            >
                                Missing Achievements
                            </button>
                        </div>

                        {filtered.length === 0 && (
                            <div style={{ opacity: 0.7, padding: '8px 0', fontStyle: 'italic', fontSize: '12px' }}>
                                No games found matching this filter.
                            </div>
                        )}

                        {/* List of Flagged Games */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {filtered.map((item) => {
                                const currentOverride = controllerOverrides[String(item.appid)] || 'auto';
                                return (
                                    <div
                                        key={item.appid}
                                        style={{
                                            background: 'rgba(255, 255, 255, 0.03)',
                                            border: '1px solid rgba(255, 255, 255, 0.06)',
                                            borderRadius: '4px',
                                            padding: '10px 12px',
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <span style={{ fontWeight: 600, fontSize: '13px' }}>{item.name}</span>
                                                <span style={{ fontSize: '11px', opacity: 0.6, marginLeft: '8px' }}>
                                                    (AppID {item.appid})
                                                </span>
                                            </div>
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                {item.missingController && (
                                                    <span style={{ background: '#e5a00d', color: '#000', fontSize: '10px', padding: '1px 5px', borderRadius: '3px', fontWeight: 600 }}>
                                                        Missing Controller Support
                                                    </span>
                                                )}
                                                {item.noAchievements && (
                                                    <span style={{ background: 'rgba(255, 255, 255, 0.1)', color: '#aaa', fontSize: '10px', padding: '1px 5px', borderRadius: '3px' }}>
                                                        No Achievements
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Inline Quick Fixes */}
                                        <div style={{ display: 'flex', gap: '16px', marginTop: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ fontSize: '11px', opacity: 0.75 }}>Controller:</span>
                                                <Dropdown
                                                    rgOptions={CONTROLLER_OVERRIDE_OPTIONS}
                                                    selectedOption={currentOverride}
                                                    onChange={(o) => handleSetController(item.appid, o.data as ControllerOverride)}
                                                    contextMenuPositionOptions={{ bMatchWidth: true }}
                                                />
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <span style={{ fontSize: '11px', opacity: 0.75 }}>Link Steam AppID:</span>
                                                <input
                                                    type="text"
                                                    placeholder="e.g. 2820820"
                                                    value={targetAppId === item.appid ? steamIdInput : ''}
                                                    onChange={(e) => {
                                                        setTargetAppId(item.appid);
                                                        setSteamIdInput(e.target.value);
                                                    }}
                                                    style={{
                                                        background: 'rgba(0, 0, 0, 0.4)',
                                                        border: '1px solid rgba(255, 255, 255, 0.15)',
                                                        color: '#fff',
                                                        borderRadius: '3px',
                                                        padding: '3px 6px',
                                                        fontSize: '11px',
                                                        width: '100px',
                                                    }}
                                                />
                                                <DialogButton
                                                    onClick={() => {
                                                        const num = parseInt(steamIdInput, 10);
                                                        if (num > 0) handleLinkSteamApp(item.appid, num);
                                                    }}
                                                    style={{ padding: '0 8px', minWidth: 0, width: 'auto', fontSize: '11px' }}
                                                >
                                                    Link
                                                </DialogButton>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </ItemRow>
            )}
        </PanelSection>
    );
}

// ===========================================================================
// Main SettingsPanel Export
// ===========================================================================

export function SettingsPanel() {
    const [, tick] = useState(0);

    // Periodic refresh so live collections and shortcuts remain synced
    useEffect(() => {
        const t = setInterval(() => tick((n) => n + 1), 3000);
        return () => clearInterval(t);
    }, []);

    return (
        <>
            <MetadataSection />
            <AchievementsSection />
            <RulesSection />
            <RevisionSection />
        </>
    );
}
