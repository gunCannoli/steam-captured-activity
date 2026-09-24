import { useEffect, useState } from 'react';
import { ButtonItem, DialogControlsSection, DialogControlsSectionHeader, DropdownItem, SliderField, ToggleField } from '@steambrew/client';
import { logger } from '../logger';
import { rpc, type ThemeEntry } from '../rpc';
import { fireTestUnlock, previewTier } from '../steam/notifications';
import { recordingDiagnostics, runningGameAppid } from '../steam/recording';
import { activeTheme, onThemeChange, reloadTheme } from '../theme/active-theme';
import { TIERS, type Tier } from '../theme/theme';
import { toastWarning } from '../steam/notification-settings';
import { DEFAULTS, RANGES, resetSettings, useSetting, type SettingKey } from './settings';

/**
 * The plugin's settings panel, shown by Millennium in its sidebar
 * (definePlugin `content`). Built only from the SDK's Steam components, with
 * no custom CSS, so focus and controller navigation come for free.
 *
 * There is deliberately no theme builder: themes are hand-edited JSON files,
 * which is also what users share. Preview + Reload make that edit loop quick.
 */

function Toggle({ k, label, description, disabled }: { k: SettingKey; label: string; description?: string; disabled?: boolean }) {
    const [value, set] = useSetting(k);
    return <ToggleField label={label} description={description} checked={value as boolean} disabled={disabled} onChange={(v) => set(v as never)} />;
}

function Slider({ k, label, suffix, disabled }: { k: SettingKey; label: string; suffix: string; disabled?: boolean }) {
    const [value, set] = useSetting(k);
    const range = RANGES[k]!;
    return (
        <SliderField
            label={label}
            value={value as number}
            min={range.min}
            max={range.max}
            step={range.step}
            showValue
            valueSuffix={suffix}
            resetValue={DEFAULTS[k] as number}
            disabled={disabled}
            onChange={(v) => set(v as never)}
        />
    );
}

function ThemeSection() {
    const [theme, setTheme] = useSetting('theme');
    const [themes, setThemes] = useState<ThemeEntry[]>([]);
    const [userDir, setUserDir] = useState('');
    const [status, setStatus] = useState(describeTheme());

    const refresh = async () => {
        try {
            const result = await rpc.listThemes();
            setThemes(result.themes);
            setUserDir(result.userDir);
        } catch (error) {
            logger.warn('Could not list themes:', error);
        }
    };

    useEffect(() => {
        void refresh();
        return onThemeChange(() => setStatus(describeTheme()));
    }, []);

    const options = themes.map((t) => ({ data: t.name, label: t.source === 'user' ? `${t.name} (yours)` : t.name }));
    if (!themes.some((t) => t.name === theme)) options.unshift({ data: theme, label: `${theme} (missing)` });

    return (
        <>
            <DropdownItem label="Theme" description={status} rgOptions={options} selectedOption={theme} onChange={(o) => setTheme(o.data as string)} />
            <ButtonItem
                label="Reload themes"
                description="Pick up edits to theme JSON files without restarting Steam."
                onClick={async () => {
                    await refresh();
                    await reloadTheme();
                }}
            >
                Reload
            </ButtonItem>
            <ButtonItem label="Open themes folder" description={userDir || 'Your themes live here and survive plugin updates.'} onClick={() => void rpc.openThemesFolder()}>
                Open
            </ButtonItem>
            <PreviewSection />
        </>
    );
}

const TIER_LABELS: Record<Tier, string> = {
    normal: 'Normal (bronze)',
    magic: 'Magic (silver)',
    rare: 'Rare (gold)',
    exceptional: 'Exceptional (100%)',
};

/** What makes an unlock land in each tier, for the active theme. */
function tierRule(tier: Tier): string {
    const tiers = activeTheme()?.theme.tiers;
    const magic = tiers?.magic.threshold, rare = tiers?.rare.threshold;
    switch (tier) {
        case 'exceptional':
            return 'The unlock that completes the game.';
        case 'rare':
            return rare !== null && rare !== undefined ? `${rare}% or fewer players have it.` : 'Not used by this theme (no threshold).';
        case 'magic':
            return magic !== null && magic !== undefined ? `${magic}% or fewer players have it.` : 'Not used by this theme (no threshold).';
        default:
            return 'Everything else, and games without rarity data.';
    }
}

/** One row per tier: fires Steam's own test achievement with that tier forced. */
function PreviewSection() {
    const [, rerender] = useState(0);
    useEffect(() => onThemeChange(() => rerender((n) => n + 1)), []);
    return (
        <DialogControlsSection>
            <DialogControlsSectionHeader>Preview a tier</DialogControlsSectionHeader>
            {TIERS.map((tier) => (
                <ButtonItem key={tier} label={TIER_LABELS[tier]} description={tierRule(tier)} onClick={() => void previewTier(tier)}>
                    Preview
                </ButtonItem>
            ))}
        </DialogControlsSection>
    );
}

function describeTheme(): string {
    const loaded = activeTheme();
    if (!loaded) return "Theme not loaded: Steam's stock toast and chime are used.";
    const warnings = loaded.theme.warnings.length;
    return `Loaded "${loaded.name}"${warnings ? `, ${warnings} warning(s) in the log` : ''}.`;
}

/** Section description showing live capture diagnostics, computed once per render (no timer). */
function captureStatus(): string {
    const diag = recordingDiagnostics();
    if (!diag.service) return "Game Recording API not found on this Steam build: captures are off.";
    if (!diag.running.some((r) => r.recording)) return 'No game is being recorded right now.';
    return `Recording ${diag.running.filter((r) => r.recording).length} game(s) now.`;
}

function CapturesSection() {
    const [screenshotOn] = useSetting('screenshot.enabled');
    const [clipOn] = useSetting('recording.enabled');
    const [status] = useState(captureStatus());
    const [testDesc, setTestDesc] = useState('Fire a test unlock for the game that is being recorded now. Creates a real screenshot/clip with your current settings.');

    return (
        <DialogControlsSection>
            <DialogControlsSectionHeader>Captures on unlock</DialogControlsSectionHeader>
            <div>{status}</div>
            <Toggle k="screenshot.enabled" label="Screenshot on unlock" description="A frame from Steam's game recording, delay after the unlock. Needs Game Recording on." />
            <Slider k="screenshot.delay_ms" label="Screenshot delay" suffix=" ms" disabled={!screenshotOn} />
            <Toggle k="recording.enabled" label="Save clip on unlock" description="Saves the last length seconds, ending delay after the unlock." />
            <Slider k="recording.duration_s" label="Clip length" suffix=" s" disabled={!clipOn} />
            <Slider k="recording.delay_ms" label="Clip delay" suffix=" ms" disabled={!clipOn} />
            <Toggle k="recording.add_timeline_marker" label="Timeline marker" description="Adds an achievement marker for non-Steam games (Steam already marks its own games)." />
            <ButtonItem
                label="Test captures"
                description={testDesc}
                onClick={() => {
                    const appid = runningGameAppid();
                    if (appid === null) {
                        setTestDesc('Start a game with Game Recording on first.');
                        return;
                    }
                    fireTestUnlock(appid, 'Enhanced Achievements test');
                    setTestDesc('Fire a test unlock for the game that is being recorded now. Creates a real screenshot/clip with your current settings.');
                }}
            >
                Test captures
            </ButtonItem>
        </DialogControlsSection>
    );
}

export function SettingsPanel() {
    const warning = toastWarning();
    return (
        <>
            <ThemeSection />
            {warning && <div>{warning}</div>}
            <Toggle k="banner.enabled" label="Themed banner" description="Off: Steam's own achievement toast." />
            <Toggle k="sound.enabled" label="Themed sound" description="Off: Steam's own chime. Steam's notification sound setting is always respected." />
            <CapturesSection />
            <ButtonItem label="Reset to defaults" description="Clear every changed setting." onClick={() => void resetSettings()}>
                Reset
            </ButtonItem>
        </>
    );
}
