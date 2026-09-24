import { useEffect, useState } from 'react';
import { ButtonItem, DialogControlsSection, DialogControlsSectionHeader, DropdownItem, ToggleField } from '@steambrew/client';
import { logger } from '../logger';
import { rpc, type ThemeEntry } from '../rpc';
import { achievementsClaims, previewCategory } from '../steam/notifications';
import { toastWarning } from '../steam/notification-settings';
import { activeTheme, onThemeChange, reloadTheme } from '../theme/active-theme';
import { CATEGORIES, type Category } from '../theme/theme';
import { resetSettings, useSetting, type SettingKey } from './settings';

/**
 * Settings panel in Millennium's sidebar (definePlugin `content`), built only
 * from the SDK's Steam components. Themes are hand-edited JSON (shareable);
 * the panel's job is picking one and previewing it quickly.
 */

const CATEGORY_LABELS: Record<Category, [string, string]> = {
    friends: ['Friends', "Friend online, in game, invites, voice chat. Shown only if Steam's Friends notification settings allow it."],
    messages: ['Messages', "Chat messages, comments, trade offers. Shown only if Steam's Friends notification settings allow it."],
    downloads: ['Downloads', 'Download complete, clip downloaded, gifts.'],
    recording: ['Recording', 'Clips, screenshots, recording start and stop.'],
    achievement: ['Achievements', 'Achievement unlocks (unless Enhanced Achievements handles them).'],
    system: ['System', 'Everything else: cloud sync, updates, battery, controllers.'],
};

function Toggle({ k, label, description }: { k: SettingKey; label: string; description: string }) {
    const [value, set] = useSetting(k);
    return <ToggleField label={label} description={description} checked={value as boolean} onChange={(v) => set(v as never)} />;
}

function describeTheme(): string {
    const loaded = activeTheme();
    if (!loaded) return 'Theme not loaded: notifications stay stock.';
    const warnings = loaded.theme.warnings.length;
    return `Loaded "${loaded.name}"${warnings ? `, ${warnings} warning(s) in the log` : ''}.`;
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
        </>
    );
}

function PreviewSection() {
    return (
        <DialogControlsSection>
            <DialogControlsSectionHeader>Preview a notification</DialogControlsSectionHeader>
            {CATEGORIES.map((category) => {
                const [label, description] = CATEGORY_LABELS[category];
                const note = category === 'achievement' && achievementsClaims('banner') ? ' Currently handled by Enhanced Achievements.' : '';
                return (
                    <ButtonItem key={category} label={label} description={description + note} onClick={() => void previewCategory(category)}>
                        Preview
                    </ButtonItem>
                );
            })}
        </DialogControlsSection>
    );
}

export function SettingsPanel() {
    const warning = toastWarning();
    return (
        <>
            <ThemeSection />
            {warning && <div>{warning}</div>}
            <PreviewSection />
            <Toggle k="style.enabled" label="Themed style" description="Off: Steam's own look for every notification." />
            <Toggle k="sound.enabled" label="Themed sounds" description="Off: Steam's own sounds. Steam's notification sound setting is always respected." />
            <Toggle k="duration.enabled" label="Themed display time" description="Off: Steam's own display time per notification." />
            <ButtonItem label="Reset to defaults" description="Clear every changed setting." onClick={() => void resetSettings()}>
                Reset
            </ButtonItem>
        </>
    );
}
