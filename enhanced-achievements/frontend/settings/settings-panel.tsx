import { useEffect, useState } from 'react';
import { ButtonItem, DialogControlsSection, DialogControlsSectionHeader, DropdownItem, SliderField, ToggleField } from '@steambrew/client';
import { logger } from '../logger';
import { rpc, type ThemeEntry } from '../rpc';
import { previewTier } from '../steam/notifications';
import { recordingDiagnostics } from '../steam/recording';
import { activeTheme, onThemeChange, reloadTheme } from '../theme/active-theme';
import { TIERS, type Tier } from '../theme/theme';
import { DEFAULTS, RANGES, resetSettings, setting, useSetting, type SettingKey } from './settings';

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
    return <ToggleField label={label} description={description} layout="below" checked={value as boolean} disabled={disabled} onChange={(v) => set(v as never)} />;
}

function Slider({ k, label, suffix, disabled }: { k: SettingKey; label: string; suffix: string; disabled?: boolean }) {
    const [value, set] = useSetting(k);
    const range = RANGES[k]!;
    return (
        <SliderField
            label={label}
            layout="below"
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

    const options: { data: string; label: string }[] = [{ data: '', label: 'Steam default' }, ...themes.map((t) => ({ data: t.name, label: t.name }))];
    if (theme && !themes.some((t) => t.name === theme)) options.push({ data: theme, label: `${theme} (missing)` });

    return (
        <DialogControlsSection>
            <DialogControlsSectionHeader>Theme</DialogControlsSectionHeader>
            <DropdownItem label="Theme" description={status} layout="below" rgOptions={options} selectedOption={theme} onChange={(o) => setTheme(o.data as string)} />
            <ButtonItem
                label="Reload themes"
                description="Pick up theme file edits without restarting Steam."
                layout="below"
                onClick={async () => {
                    await refresh();
                    await reloadTheme();
                }}
            >
                Reload
            </ButtonItem>
            <ButtonItem label="Open themes folder" description={userDir || 'Your themes, kept across plugin updates.'} layout="below" onClick={() => void rpc.openThemesFolder()}>
                Open
            </ButtonItem>
        </DialogControlsSection>
    );
}

// PreviewSection renders its own DialogControlsSection (own group), so it is
// rendered as a sibling of ThemeSection, not nested inside its section.

// Icon names (bronze/silver/gold, etc.) are a theme's own styling choice, not
// part of the tier schema, so labels stay generic; only the rule text is
// theme-driven (see tierRule).
const TIER_LABELS: Record<Tier, string> = {
    normal: 'Normal',
    magic: 'Magic',
    rare: 'Rare',
    exceptional: 'Exceptional',
};

/** What makes an unlock land in each tier, for the active theme's thresholds. */
function tierRule(tier: Tier): string {
    const tiers = activeTheme()?.theme.tiers;
    const magic = tiers?.magic.threshold, rare = tiers?.rare.threshold;
    switch (tier) {
        case 'exceptional':
            return 'The unlock that completes the game (100%).';
        case 'rare':
            return rare !== null && rare !== undefined ? `${rare}% or fewer players have it.` : 'Unused by this theme (no threshold set).';
        case 'magic':
            return magic !== null && magic !== undefined ? `${magic}% or fewer players have it.` : 'Unused by this theme (no threshold set).';
        default:
            return magic !== null && magic !== undefined ? `Everything below Magic's ${magic}%.` : 'Everything else, and games without rarity data.';
    }
}

/** One row per tier: fires Steam's own test achievement with that tier forced. */
function PreviewSection() {
    const [, rerender] = useState(0);
    useEffect(() => onThemeChange(() => rerender((n) => n + 1)), []);
    return (
        <DialogControlsSection>
            <DialogControlsSectionHeader>Preview Achievements</DialogControlsSectionHeader>
            {TIERS.map((tier) => (
                <ButtonItem key={tier} label={TIER_LABELS[tier]} description={tierRule(tier)} layout="below" onClick={() => void previewTier(tier)}>
                    Preview
                </ButtonItem>
            ))}
        </DialogControlsSection>
    );
}

function describeTheme(): string {
    const loaded = activeTheme();
    if (!loaded) {
        return setting('theme')
            ? "Could not load this theme: using Steam's stock toast and chime."
            : "Using Steam's own toast and chime.";
    }
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

    return (
        <DialogControlsSection>
            <DialogControlsSectionHeader>Screenshots &amp; Recordings</DialogControlsSectionHeader>
            <div>{status}</div>
            <Toggle k="screenshot.enabled" label="Screenshot on unlock" description="Needs Game Recording on." />
            <Slider k="screenshot.delay_ms" label="Screenshot delay" suffix=" ms" disabled={!screenshotOn} />
            <Toggle k="recording.enabled" label="Save clip on unlock" description="Saves the last length seconds." />
            <Slider k="recording.duration_s" label="Clip length" suffix=" s" disabled={!clipOn} />
            <Slider k="recording.delay_ms" label="Clip delay" suffix=" ms" disabled={!clipOn} />
            <Toggle k="recording.add_timeline_marker" label="Timeline marker" description="Non-Steam games only." />
        </DialogControlsSection>
    );
}

export function SettingsPanel() {
    return (
        <>
            <ThemeSection />
            <PreviewSection />
            <DialogControlsSection>
                <DialogControlsSectionHeader>General</DialogControlsSectionHeader>
                <Toggle k="queue.enabled" label="Achievement queue" description="One banner at a time instead of Steam's stacking." />
            </DialogControlsSection>
            <CapturesSection />
            <DialogControlsSection>
                <ButtonItem label="Reset to defaults" description="Clear every changed setting." layout="below" onClick={() => void resetSettings()}>
                    Reset
                </ButtonItem>
            </DialogControlsSection>
        </>
    );
}
