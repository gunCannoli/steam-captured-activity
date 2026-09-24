import { useEffect, useState } from 'react';
import { ButtonItem, DialogControlsSection, DialogControlsSectionHeader, DropdownItem, SliderField, ToggleField } from '@steambrew/client';
import { logger } from '../logger';
import { rpc, type ThemeEntry } from '../rpc';
import { previewTier } from '../steam/notifications';
import { activeTheme, onThemeChange, reloadTheme } from '../theme/active-theme';
import { TIERS, type Tier } from '../theme/theme';
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

export function SettingsPanel() {
    const phase7 = 'Available with auto-captures (not yet shipped).';
    return (
        <>
            <ThemeSection />
            <Toggle k="banner.enabled" label="Themed banner" description="Off: Steam's own achievement toast." />
            <Toggle k="sound.enabled" label="Themed sound" description="Off: Steam's own chime. Steam's notification sound setting is always respected." />
            <Toggle k="screenshot.enabled" label="Screenshot on unlock" description={phase7} disabled />
            <Slider k="screenshot.delay_ms" label="Screenshot delay" suffix=" ms" disabled />
            <Toggle k="recording.enabled" label="Save clip on unlock" description={phase7} disabled />
            <Slider k="recording.duration_s" label="Clip length" suffix=" s" disabled />
            <Slider k="recording.delay_ms" label="Clip delay" suffix=" ms" disabled />
            <Toggle k="recording.add_timeline_marker" label="Timeline marker" description={phase7} disabled />
            <ButtonItem label="Reset to defaults" description="Clear every changed setting." onClick={() => void resetSettings()}>
                Reset
            </ButtonItem>
        </>
    );
}
