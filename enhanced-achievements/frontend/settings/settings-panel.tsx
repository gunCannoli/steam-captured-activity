import { useEffect, useState } from 'react';
import { ButtonItem, DialogBodyText, DialogControlsSection, DialogControlsSectionHeader, DropdownItem, SliderField, ToggleField } from '@steambrew/client';
import { logger } from '../logger';
import { rpc, type ThemeEntry } from '../rpc';
import { previewTier } from '../steam/notifications';
import { toastsEnabled } from '../steam/notification-settings';
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
 *
 * Every row but the last in a group passes `bottomSeparator="none"`, and
 * every row passes `transparentBackground`, matching how Steam's own
 * settings pages space a group: one flat surface per group, one separator
 * between rows, one gap between groups (DialogControlsSection's own
 * margin). `transparentBackground` is a real prop of the SDK's underlying
 * `Field` component (verified against the live client's own source,
 * frontend/steam/webpack.ts-style resolution — not a made-up class), just
 * missing from @steambrew/client's .d.ts; without it every row painted its
 * own background card (Steam's `Background` class applies outside Steam's
 * own "classic" render context, which a Millennium sidebar panel is), which
 * is what actually produced the boxed-card look and uneven gaps —
 * `bottomSeparator` alone never controlled that.
 */

/** transparentBackground is a real Field prop, missing from the SDK's .d.ts (see doc comment above). */
const FLAT = { transparentBackground: true } as { transparentBackground: true };

function Toggle({ k, label, description, disabled, last }: { k: SettingKey; label: string; description?: string; disabled?: boolean; last?: boolean }) {
    const [value, set] = useSetting(k);
    return (
        <ToggleField
            {...FLAT}
            label={label}
            description={description}
            layout="below"
            bottomSeparator={last ? 'standard' : 'none'}
            checked={value as boolean}
            disabled={disabled}
            onChange={(v) => set(v as never)}
        />
    );
}

function Slider({ k, label, suffix, disabled, last }: { k: SettingKey; label: string; suffix: string; disabled?: boolean; last?: boolean }) {
    const [value, set] = useSetting(k);
    const range = RANGES[k]!;
    return (
        <SliderField
            {...FLAT}
            label={label}
            layout="below"
            bottomSeparator={last ? 'standard' : 'none'}
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

/** Poll while the panel is mounted: cheap after the first call (notification-settings.ts caches the resolved store). */
function usePanelDisabled(): boolean {
    const [enabled, setEnabled] = useState(toastsEnabled());
    useEffect(() => {
        const id = setInterval(() => setEnabled(toastsEnabled()), 2000);
        return () => clearInterval(id);
    }, []);
    return enabled === false;
}

function ThemeSection({ disabled }: { disabled: boolean }) {
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
            <DropdownItem
                {...FLAT}
                label="Theme"
                description={status}
                layout="below"
                bottomSeparator="none"
                disabled={disabled}
                rgOptions={options}
                selectedOption={theme}
                onChange={(o) => setTheme(o.data as string)}
            />
            <ButtonItem
                {...FLAT}
                label="Reload themes"
                description="Pick up theme file edits without restarting Steam."
                layout="below"
                bottomSeparator="none"
                disabled={disabled}
                onClick={async () => {
                    await refresh();
                    await reloadTheme();
                }}
            >
                Reload
            </ButtonItem>
            <ButtonItem
                {...FLAT}
                label="Open themes folder"
                description={userDir || 'Your themes, kept across plugin updates.'}
                layout="below"
                disabled={disabled}
                onClick={() => void rpc.openThemesFolder()}
            >
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
function PreviewSection({ disabled }: { disabled: boolean }) {
    const [, rerender] = useState(0);
    useEffect(() => onThemeChange(() => rerender((n) => n + 1)), []);
    return (
        <DialogControlsSection>
            <DialogControlsSectionHeader>Preview Achievements</DialogControlsSectionHeader>
            {TIERS.map((tier, i) => (
                <ButtonItem
                    {...FLAT}
                    key={tier}
                    label={TIER_LABELS[tier]}
                    description={tierRule(tier)}
                    layout="below"
                    bottomSeparator={i === TIERS.length - 1 ? 'standard' : 'none'}
                    disabled={disabled}
                    onClick={() => void previewTier(tier)}
                >
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

function CapturesSection({ disabled }: { disabled: boolean }) {
    const [screenshotOn] = useSetting('screenshot.enabled');
    const [clipOn] = useSetting('recording.enabled');

    return (
        <DialogControlsSection>
            <DialogControlsSectionHeader>Screenshots &amp; Recordings</DialogControlsSectionHeader>
            <Toggle k="screenshot.enabled" label="Screenshot on unlock" description="Needs Game Recording on." disabled={disabled} />
            <Slider k="screenshot.delay_ms" label="Screenshot delay" suffix=" ms" disabled={disabled || !screenshotOn} />
            <Toggle k="recording.enabled" label="Save clip on unlock" description="Saves the last length seconds." disabled={disabled} />
            <Slider k="recording.duration_s" label="Clip length" suffix=" s" disabled={disabled || !clipOn} />
            <Slider k="recording.delay_ms" label="Clip delay" suffix=" ms" disabled={disabled || !clipOn} />
            <Toggle k="recording.add_timeline_marker" label="Timeline marker" description="Non-Steam games only." last disabled={disabled} />
        </DialogControlsSection>
    );
}

export function SettingsPanel() {
    const disabled = usePanelDisabled();

    return (
        <>
            {disabled && (
                <DialogBodyText>
                    Steam's toast notifications are off, so this plugin cannot trigger anything. Turn them on in Steam
                    Settings -&gt; Notifications.
                </DialogBodyText>
            )}
            <ThemeSection disabled={disabled} />
            <PreviewSection disabled={disabled} />
            <DialogControlsSection>
                <DialogControlsSectionHeader>General</DialogControlsSectionHeader>
                <Toggle k="queue.enabled" label="Achievement queue" description="One banner at a time instead of Steam's stacking." last disabled={disabled} />
            </DialogControlsSection>
            <CapturesSection disabled={disabled} />
            <DialogControlsSection>
                <ButtonItem {...FLAT} label="Reset to defaults" description="Clear every changed setting." layout="below" disabled={disabled} onClick={() => void resetSettings()}>
                    Reset
                </ButtonItem>
            </DialogControlsSection>
        </>
    );
}
