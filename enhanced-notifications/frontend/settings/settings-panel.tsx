import { useEffect, useState } from 'react';
import { DialogBodyText, Dropdown, Field, PanelSection } from '@steambrew/client';
import { logger } from '../logger';
import { rpc, type ThemeEntry } from '../rpc';
import { achievementsClaims } from '../steam/coexistence';
import { activeTheme, onThemeChange, reloadTheme } from '../theme/active-theme';
import { CATEGORIES, type Category } from '../theme/theme';
import { resetSettings, setting, useSetting } from './settings';
import { Blocks, ButtonRow, ItemRow, ToggleRow, usePanelDisabled } from './rows';

/**
 * Settings panel in Millennium's sidebar (definePlugin `content`), laid out like
 * enhanced-achievements' (docs/plugins.md guardrail 18): Steam's components, the
 * rows and spacing system of ./rows.tsx (a copy shared with that plugin). Themes are
 * hand-edited JSONC (shareable); the panel's job is picking one and previewing it quickly.
 */

const CATEGORY_LABELS: Record<Category, [string, string]> = {
    friends: ['Friends', "Friend online, in game, invites, voice chat. Shown only if Steam's Friends notification settings allow it"],
    messages: ['Messages', "Chat messages, comments, trade offers. Shown only if Steam's Friends notification settings allow it"],
    downloads: ['Downloads', 'Download complete, clip downloaded, gifts'],
    recording: ['Recording', 'Clips, screenshots, recording start and stop'],
    achievement: ['Achievements', 'Achievement unlocks (unless Enhanced Achievements handles them)'],
    system: ['System', 'Everything else: cloud sync, updates, battery, controllers'],
};

/** A problem with the selected theme worth showing under the dropdown, or null when all is well. */
function themeProblem(): string | null {
    const loaded = activeTheme();
    if (!loaded) return setting('theme') ? "Could not load this theme (see the log): notifications keep Steam's look and sound." : null;
    const warnings = loaded.theme.warnings.length;
    return warnings ? `Loaded with ${warnings} warning${warnings === 1 ? '' : 's'} (see the log): the affected fields keep Steam's own.` : null;
}

function ThemeSection({ disabled }: { disabled: boolean }) {
    const [theme, setTheme] = useSetting('theme');
    const [themes, setThemes] = useState<ThemeEntry[]>([]);
    const [userDir, setUserDir] = useState('');
    const [problem, setProblem] = useState(themeProblem());

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
        return onThemeChange(() => setProblem(themeProblem()));
    }, []);

    const options = themes.map((t) => ({ data: t.name, label: t.source === 'user' ? `${t.name} (yours)` : t.name }));
    if (!themes.some((t) => t.name === theme)) options.push({ data: theme, label: `${theme} (missing)` });

    return (
        <PanelSection title="Theme">
            <Blocks>
                <>
                    {/* Three rows: label, description, then the dropdown across the full row (guardrail 18.3). */}
                    <ItemRow>
                        <Field label="Available themes" description="Select a theme to choose the notification style" disabled={disabled} bottomSeparator="none" />
                    </ItemRow>
                    <ItemRow>
                        <Field disabled={disabled} childrenContainerWidth="max">
                            <Dropdown
                                rgOptions={options}
                                selectedOption={theme}
                                disabled={disabled}
                                contextMenuPositionOptions={{ bMatchWidth: true }}
                                onChange={(o) => setTheme(o.data as string)}
                            />
                        </Field>
                    </ItemRow>
                    {problem && (
                        <ItemRow>
                            <DialogBodyText>{problem}</DialogBodyText>
                        </ItemRow>
                    )}
                </>
                <>
                    <ButtonRow
                        label="Reload themes"
                        description="Pick up theme file edits without restarting Steam"
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
                        label="Themes folder"
                        description={userDir || 'Your themes live here and survive plugin updates'}
                        buttonLabel="Open"
                        disabled={disabled}
                        onClick={() => void rpc.openThemesFolder()}
                    />
                </>
            </Blocks>
        </PanelSection>
    );
}

function PreviewSection({ disabled, onPreview }: { disabled: boolean; onPreview: (category: Category) => Promise<void> }) {
    return (
        <PanelSection title="Preview notifications">
            {CATEGORIES.map((category) => {
                const [label, description] = CATEGORY_LABELS[category];
                const note = category === 'achievement' && achievementsClaims('banner') ? '. Currently handled by Enhanced Achievements' : '';
                return <ButtonRow key={category} label={label} description={description + note} buttonLabel="Preview" disabled={disabled} onClick={() => void onPreview(category)} />;
            })}
        </PanelSection>
    );
}

/** `onPreview` is injected by index.tsx: the panel never imports a surface. */
export function SettingsPanel({ onPreview }: { onPreview: (category: Category) => Promise<void> }) {
    const disabled = usePanelDisabled();

    return (
        <>
            {disabled && (
                <DialogBodyText>
                    Steam's toast notifications are off, so styled toasts, sounds and display time will not show. Turn them on in Steam Settings -&gt;
                    Notifications.
                </DialogBodyText>
            )}

            <ThemeSection disabled={disabled} />
            <PreviewSection disabled={disabled} onPreview={onPreview} />

            <PanelSection title="General">
                <ToggleRow k="style.enabled" label="Themed style" description="Off: Steam's own look for every notification" disabled={disabled} />
                <ToggleRow k="sound.enabled" label="Themed sounds" description="Off: Steam's own sounds. Steam's notification sound setting is always respected" disabled={disabled} />
                <ToggleRow k="duration.enabled" label="Themed display time" description="Off: Steam's own display time per notification" disabled={disabled} />
            </PanelSection>

            <PanelSection title="Reset">
                <ButtonRow label="Reset to defaults" description="Clear every changed setting" buttonLabel="Reset" disabled={disabled} onClick={() => void resetSettings()} />
            </PanelSection>
        </>
    );
}
