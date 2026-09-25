import { useEffect, useState } from 'react';
import { DialogBodyText, DialogButton, Dropdown, Field, PanelSection, PanelSectionRow, SliderField, Toggle as SteamToggle } from '@steambrew/client';
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
 * Uses `PanelSection`/`PanelSectionRow` for grouping, not
 * `DialogControlsSection`/`DialogControlsSectionHeader` — this repo's own
 * docs/knowledgebase.md already documents `Panel` as "the titled-section
 * container used in Settings and Quick Access", i.e. the sidebar context a
 * Millennium plugin panel actually renders in, where `DialogControlsSection`
 * is the layout for Steam's full Settings *dialog* instead. Two earlier
 * attempts to fix uneven spacing by tweaking `Field` props
 * (`bottomSeparator`, `transparentBackground`) while keeping
 * `DialogControlsSection` did not fix it (confirmed by screenshot both
 * times) — the container was the actual problem, not a prop on the rows.
 * Each row is a plain `Field` (label + description) wrapping a bare control
 * (`Toggle`, `Dropdown`, `DialogButton`), matching Millennium's own settings
 * UI for themes (`ThemeEditor.tsx`) — not the combined `ToggleField`/
 * `ButtonItem`/`DropdownItem` wrappers, which carry the same `Field`
 * defaults that caused the boxed-row look.
 */

function ToggleRow({ k, label, description, disabled }: { k: SettingKey; label: string; description?: string; disabled?: boolean }) {
    const [value, set] = useSetting(k);
    return (
        <PanelSectionRow>
            <Field label={label} description={description} disabled={disabled}>
                <SteamToggle value={value as boolean} disabled={disabled} onChange={(v) => set(v as never)} />
            </Field>
        </PanelSectionRow>
    );
}

function SliderRow({ k, label, suffix, disabled }: { k: SettingKey; label: string; suffix: string; disabled?: boolean }) {
    const [value, set] = useSetting(k);
    const range = RANGES[k]!;
    return (
        <PanelSectionRow>
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
        <PanelSectionRow>
            <Field label={label} description={description} disabled={disabled}>
                <DialogButton disabled={disabled} onClick={onClick}>
                    {buttonLabel}
                </DialogButton>
            </Field>
        </PanelSectionRow>
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
        <PanelSection title="Theme">
            <PanelSectionRow>
                <Field label="Theme" description={status} disabled={disabled}>
                    <Dropdown rgOptions={options} selectedOption={theme} disabled={disabled} onChange={(o) => setTheme(o.data as string)} />
                </Field>
            </PanelSectionRow>
            <ButtonRow
                label="Reload themes"
                description="Pick up theme file edits without restarting Steam."
                buttonLabel="Reload"
                disabled={disabled}
                onClick={() => {
                    void (async () => {
                        await refresh();
                        await reloadTheme();
                    })();
                }}
            />
            <ButtonRow
                label="Open themes folder"
                description={userDir || 'Your themes, kept across plugin updates.'}
                buttonLabel="Open"
                disabled={disabled}
                onClick={() => void rpc.openThemesFolder()}
            />
        </PanelSection>
    );
}

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
        <PanelSection title="Preview Achievements">
            {TIERS.map((tier) => (
                <ButtonRow
                    key={tier}
                    label={TIER_LABELS[tier]}
                    description={tierRule(tier)}
                    buttonLabel="Preview"
                    disabled={disabled}
                    onClick={() => void previewTier(tier)}
                />
            ))}
        </PanelSection>
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
        <PanelSection title="Screenshots & Recordings">
            <ToggleRow k="screenshot.enabled" label="Screenshot on unlock" description="Needs Game Recording on." disabled={disabled} />
            <SliderRow k="screenshot.delay_ms" label="Screenshot delay" suffix=" ms" disabled={disabled || !screenshotOn} />
            <ToggleRow k="recording.enabled" label="Save clip on unlock" description="Saves the last length seconds." disabled={disabled} />
            <SliderRow k="recording.duration_s" label="Clip length" suffix=" s" disabled={disabled || !clipOn} />
            <SliderRow k="recording.delay_ms" label="Clip delay" suffix=" ms" disabled={disabled || !clipOn} />
            <ToggleRow k="recording.add_timeline_marker" label="Timeline marker" description="Non-Steam games only." disabled={disabled} />
        </PanelSection>
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
            <PanelSection title="General">
                <ToggleRow k="queue.enabled" label="Achievement queue" description="One banner at a time instead of Steam's stacking." disabled={disabled} />
            </PanelSection>
            <CapturesSection disabled={disabled} />
            <PanelSection title="Reset">
                <ButtonRow label="Reset to defaults" description="Clear every changed setting." buttonLabel="Reset" disabled={disabled} onClick={() => void resetSettings()} />
            </PanelSection>
        </>
    );
}
